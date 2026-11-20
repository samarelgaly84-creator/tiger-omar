import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { eq, desc, and, sql, ilike, isNull } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { cloudFiles, cloudFolders, fileShares, users } from '../../db/schema.ts';
import { requireAuth, optionalAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware, extractFileText, safeDeleteUploadedFile, UPLOADS_ROOT } from '../upload.ts';
import { createNotification } from '../notify.ts';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.dbUser!.id;
    const folderId = req.query.folderId ? Number(req.query.folderId) : null;
    const trash = req.query.trash === 'true';
    const search = String(req.query.q || '').trim();

    const folders = await db
      .select()
      .from(cloudFolders)
      .where(
        and(
          eq(cloudFolders.ownerId, ownerId),
          eq(cloudFolders.isTrashed, trash),
          search
            ? ilike(cloudFolders.name, `%${search}%`)
            : folderId
            ? eq(cloudFolders.parentId, folderId)
            : isNull(cloudFolders.parentId)
        )
      )
      .orderBy(desc(cloudFolders.createdAt));

    const files = await db
      .select()
      .from(cloudFiles)
      .where(
        and(
          eq(cloudFiles.ownerId, ownerId),
          eq(cloudFiles.isTrashed, trash),
          search
            ? ilike(cloudFiles.fileName, `%${search}%`)
            : folderId
            ? eq(cloudFiles.folderId, folderId)
            : isNull(cloudFiles.folderId)
        )
      )
      .orderBy(desc(cloudFiles.createdAt));

    const [freshUser] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);

    res.json({
      folders,
      files,
      storageUsedBytes: freshUser?.storageUsedBytes || 0,
      storageQuotaBytes: freshUser?.storageQuotaBytes || 104857600,
    });
  } catch (err) {
    console.error('GET /api/cloud failed:', err);
    res.status(500).json({ error: 'Failed to load cloud drive' });
  }
});

router.post('/folders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const parentId = req.body?.parentId ? Number(req.body.parentId) : null;

    const [folder] = await db
      .insert(cloudFolders)
      .values({ ownerId: req.dbUser!.id, parentId, name: name.slice(0, 120) })
      .returning();

    res.status(201).json({ folder });
  } catch (err) {
    console.error('POST /api/cloud/folders failed:', err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

router.post('/upload', requireAuth, uploadMiddleware.array('files', 10), async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const folderId = req.body?.folderId ? Number(req.body.folderId) : null;
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    const [freshUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (freshUser && freshUser.storageUsedBytes + totalSize > freshUser.storageQuotaBytes) {
      files.forEach((f) => safeDeleteUploadedFile(f.path));
      return res.status(413).json({
        error: 'Storage quota exceeded. Upgrade to TIGER PLUS or PRO or delete unused files.',
      });
    }

    const inserted = [];
    for (const f of files) {
      const extractedText = await extractFileText(f.path, f.mimetype);
      const [row] = await db
        .insert(cloudFiles)
        .values({
          ownerId: userId,
          folderId,
          fileName: f.originalname,
          originalName: f.originalname,
          mimeType: f.mimetype,
          fileSize: f.size,
          storagePath: f.path,
          publicUrl: `/uploads/${f.filename}`,
          extractedText,
        })
        .returning();
      inserted.push(row);
    }

    await db
      .update(users)
      .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${totalSize}` })
      .where(eq(users.id, userId));

    res.status(201).json({ files: inserted });
  } catch (err) {
    console.error('POST /api/cloud/upload failed:', err);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

router.patch('/files/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const fileId = Number(req.params.id);
    const [file] = await db.select().from(cloudFiles).where(eq(cloudFiles.id, fileId)).limit(1);
    if (!file || file.ownerId !== req.dbUser!.id) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { fileName, folderId, isTrashed } = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof fileName === 'string' && fileName.trim()) updates.fileName = fileName.trim().slice(0, 180);
    if (folderId !== undefined) updates.folderId = folderId === null ? null : Number(folderId);
    if (typeof isTrashed === 'boolean') {
      updates.isTrashed = isTrashed;
      updates.trashedAt = isTrashed ? new Date() : null;
    }

    const [updated] = await db.update(cloudFiles).set(updates).where(eq(cloudFiles.id, fileId)).returning();
    res.json({ file: updated });
  } catch (err) {
    console.error('PATCH /api/cloud/files/:id failed:', err);
    res.status(500).json({ error: 'Failed to update file' });
  }
});

router.post('/files/:id/copy', requireAuth, async (req: AuthRequest, res) => {
  try {
    const fileId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [file] = await db.select().from(cloudFiles).where(eq(cloudFiles.id, fileId)).limit(1);
    if (!file || file.ownerId !== userId) return res.status(404).json({ error: 'File not found' });

    const [freshUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (freshUser && freshUser.storageUsedBytes + file.fileSize > freshUser.storageQuotaBytes) {
      return res.status(413).json({ error: 'Storage quota exceeded' });
    }

    const ext = path.extname(file.storagePath);
    const newFilename = `${Date.now()}_copy_${crypto.randomBytes(6).toString('hex')}${ext}`;
    const newPath = path.join(UPLOADS_ROOT, newFilename);
    if (fs.existsSync(file.storagePath)) {
      fs.copyFileSync(file.storagePath, newPath);
    }

    const [copied] = await db
      .insert(cloudFiles)
      .values({
        ownerId: userId,
        folderId: req.body?.folderId !== undefined ? req.body.folderId : file.folderId,
        fileName: `Copy of ${file.fileName}`,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        storagePath: newPath,
        publicUrl: `/uploads/${newFilename}`,
        extractedText: file.extractedText,
      })
      .returning();

    await db
      .update(users)
      .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${file.fileSize}` })
      .where(eq(users.id, userId));

    res.status(201).json({ file: copied });
  } catch (err) {
    console.error('POST /api/cloud/files/:id/copy failed:', err);
    res.status(500).json({ error: 'Failed to copy file' });
  }
});

router.delete('/files/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const fileId = Number(req.params.id);
    const [file] = await db.select().from(cloudFiles).where(eq(cloudFiles.id, fileId)).limit(1);
    if (!file || (file.ownerId !== req.dbUser!.id && req.dbUser!.role !== 'admin')) {
      return res.status(404).json({ error: 'File not found' });
    }

    safeDeleteUploadedFile(file.storagePath);
    await db.delete(cloudFiles).where(eq(cloudFiles.id, fileId));
    await db
      .update(users)
      .set({ storageUsedBytes: sql`GREATEST(0, ${users.storageUsedBytes} - ${file.fileSize})` })
      .where(eq(users.id, file.ownerId));

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/cloud/files/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.patch('/folders/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const folderId = Number(req.params.id);
    const [folder] = await db.select().from(cloudFolders).where(eq(cloudFolders.id, folderId)).limit(1);
    if (!folder || folder.ownerId !== req.dbUser!.id) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    const { name, isTrashed } = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof isTrashed === 'boolean') updates.isTrashed = isTrashed;

    const [updated] = await db.update(cloudFolders).set(updates).where(eq(cloudFolders.id, folderId)).returning();
    res.json({ folder: updated });
  } catch (err) {
    console.error('PATCH /api/cloud/folders/:id failed:', err);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

router.delete('/folders/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const folderId = Number(req.params.id);
    const [folder] = await db.select().from(cloudFolders).where(eq(cloudFolders.id, folderId)).limit(1);
    if (!folder || folder.ownerId !== req.dbUser!.id) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    await db.delete(cloudFolders).where(eq(cloudFolders.id, folderId));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/cloud/folders/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

router.post('/share', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { fileId, folderId, sharedWithUserId, permission, expiresInHours } = req.body || {};
    if (!fileId && !folderId) return res.status(400).json({ error: 'File or folder ID required' });

    if (fileId) {
      const [file] = await db.select().from(cloudFiles).where(eq(cloudFiles.id, Number(fileId))).limit(1);
      if (!file || file.ownerId !== req.dbUser!.id) return res.status(403).json({ error: 'Not authorized' });
    }

    const shareToken = crypto.randomBytes(18).toString('hex');
    const expiresAt = expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600_000) : null;

    const [share] = await db
      .insert(fileShares)
      .values({
        fileId: fileId ? Number(fileId) : null,
        folderId: folderId ? Number(folderId) : null,
        ownerId: req.dbUser!.id,
        sharedWithUserId: sharedWithUserId ? Number(sharedWithUserId) : null,
        shareToken,
        permission: permission === 'edit' ? 'edit' : 'view',
        expiresAt,
      })
      .returning();

    if (sharedWithUserId) {
      await createNotification({
        userId: Number(sharedWithUserId),
        actorId: req.dbUser!.id,
        type: 'file_share',
        title: 'ملف مشترك معك',
        body: `${req.dbUser!.displayName} شارك ملفاً سحابياً معك`,
        entityType: 'file',
        entityId: fileId ? Number(fileId) : Number(folderId),
      });
    }

    res.status(201).json({ share });
  } catch (err) {
    console.error('POST /api/cloud/share failed:', err);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

router.get('/shared/:token', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const [share] = await db
      .select()
      .from(fileShares)
      .where(eq(fileShares.shareToken, req.params.token))
      .limit(1);

    if (!share) return res.status(404).json({ error: 'Invalid share link' });
    if (share.expiresAt && share.expiresAt < new Date()) {
      return res.status(410).json({ error: 'Share link expired' });
    }
    if (share.sharedWithUserId && req.dbUser?.id !== share.sharedWithUserId && req.dbUser?.id !== share.ownerId) {
      return res.status(403).json({ error: 'Private share link restricted to specific user' });
    }

    const file = share.fileId
      ? (await db.select().from(cloudFiles).where(eq(cloudFiles.id, share.fileId)).limit(1))[0] || null
      : null;

    res.json({ share, file });
  } catch (err) {
    console.error('GET /api/cloud/shared/:token failed:', err);
    res.status(500).json({ error: 'Failed to access shared item' });
  }
});

export default router;
