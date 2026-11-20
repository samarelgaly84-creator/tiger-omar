import { Router } from 'express';
import { eq, desc, inArray, and } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { chats, chatMembers, messages, messageAttachments, users } from '../../db/schema.ts';
import { requireAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware } from '../upload.ts';
import { broadcastToUsers } from '../ws.ts';
import { createNotification } from '../notify.ts';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const memberships = await db.select().from(chatMembers).where(eq(chatMembers.userId, userId));
    if (memberships.length === 0) return res.json({ chats: [] });

    const chatIds = memberships.map((m) => m.chatId);
    const [chatRows, allMembers, recentMessages] = await Promise.all([
      db.select().from(chats).where(inArray(chats.id, chatIds)).orderBy(desc(chats.lastMessageAt)),
      db.select().from(chatMembers).where(inArray(chatMembers.chatId, chatIds)),
      db.select().from(messages).where(inArray(messages.chatId, chatIds)).orderBy(desc(messages.createdAt)).limit(300),
    ]);

    const memberUserIds = Array.from(new Set(allMembers.map((m) => m.userId)));
    const memberUsers = await db.select().from(users).where(inArray(users.id, memberUserIds));
    const userMap = new Map(memberUsers.map((u) => [u.id, u]));
    const myMemMap = new Map(memberships.map((m) => [m.chatId, m]));

    const enriched = chatRows.map((c) => {
      const mem = myMemMap.get(c.id)!;
      const participants = allMembers
        .filter((m) => m.chatId === c.id)
        .map((m) => {
          const u = userMap.get(m.userId);
          return u
            ? {
                id: u.id,
                username: u.username,
                displayName: u.displayName,
                avatarUrl: u.avatarUrl,
                isOnline: u.isOnline,
                lastSeenAt: u.lastSeenAt,
                publicKeyJwk: u.publicKeyJwk,
                role: m.role,
              }
            : null;
        })
        .filter(Boolean);

      const lastMsg = recentMessages.find((m) => m.chatId === c.id && !m.isDeleted) || null;
      return {
        ...c,
        membership: mem,
        participants,
        lastMessage: lastMsg,
      };
    });

    enriched.sort((a, b) => {
      if (a.membership.isPinned !== b.membership.isPinned) return a.membership.isPinned ? -1 : 1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    res.json({ chats: enriched });
  } catch (err) {
    console.error('GET /api/chats failed:', err);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

router.post('/direct', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const targetUserId = Number(req.body?.targetUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0 || targetUserId === userId) {
      return res.status(400).json({ error: 'Invalid target user' });
    }

    const [targetUser] = await db
      .select({ id: users.id, isBanned: users.isBanned })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({ error: 'Target account not found' });
    }
    if (targetUser.isBanned) {
      return res.status(403).json({ error: 'Target account is unavailable' });
    }

    // Check existing direct chat
    const myChats = await db.select().from(chatMembers).where(eq(chatMembers.userId, userId));
    const targetChats = await db.select().from(chatMembers).where(eq(chatMembers.userId, targetUserId));
    const commonIds = myChats
      .map((c) => c.chatId)
      .filter((id) => targetChats.some((t) => t.chatId === id));

    if (commonIds.length > 0) {
      const existingDirect = await db
        .select()
        .from(chats)
        .where(and(inArray(chats.id, commonIds), eq(chats.chatType, 'direct')))
        .limit(1);
      if (existingDirect.length > 0) {
        return res.json({ chat: existingDirect[0] });
      }
    }

    const [created] = await db
      .insert(chats)
      .values({ chatType: 'direct', createdBy: userId })
      .returning();

    await db.insert(chatMembers).values([
      { chatId: created.id, userId, role: 'admin' },
      { chatId: created.id, userId: targetUserId, role: 'member' },
    ]);

    res.status(201).json({ chat: created });
  } catch (err) {
    console.error('POST /api/chats/direct failed:', err);
    res.status(500).json({ error: 'Failed to open direct chat' });
  }
});

router.post('/group', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { name, memberIds } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Group chat name required' });

    const [created] = await db
      .insert(chats)
      .values({ chatType: 'group', name: String(name).trim().slice(0, 80), createdBy: userId })
      .returning();

    const uniqueIds = Array.from(
      new Set([userId, ...(Array.isArray(memberIds) ? memberIds.map(Number).filter(Boolean) : [])])
    );

    await db.insert(chatMembers).values(
      uniqueIds.map((uid) => ({
        chatId: created.id,
        userId: uid,
        role: uid === userId ? 'admin' : 'member',
      }))
    );

    res.status(201).json({ chat: created });
  } catch (err) {
    console.error('POST /api/chats/group failed:', err);
    res.status(500).json({ error: 'Failed to create group chat' });
  }
});

router.get('/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const chatId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const search = String(req.query.q || '').trim().toLowerCase();

    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
      .limit(1);
    if (!member) return res.status(403).json({ error: 'Not a member of this chat' });

    let rows = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.createdAt)
      .limit(200);

    if (search) {
      rows = rows.filter((m) => (m.content || '').toLowerCase().includes(search));
    }

    const msgIds = rows.map((m) => m.id);
    const attachments =
      msgIds.length > 0
        ? await db.select().from(messageAttachments).where(inArray(messageAttachments.messageId, msgIds))
        : [];

    const senderIds = Array.from(new Set(rows.map((m) => m.senderId)));
    const senders =
      senderIds.length > 0 ? await db.select().from(users).where(inArray(users.id, senderIds)) : [];
    const senderMap = new Map(senders.map((u) => [u.id, u]));

    // Mark unread messages as read
    for (const m of rows) {
      if (m.senderId !== userId && !m.readBy.includes(userId)) {
        const updatedReadBy = [...m.readBy, userId];
        await db.update(messages).set({ readBy: updatedReadBy }).where(eq(messages.id, m.id));
        m.readBy = updatedReadBy;
      }
    }

    res.json({
      messages: rows.map((m) => ({
        ...m,
        sender: senderMap.get(m.senderId)
          ? {
              id: senderMap.get(m.senderId)!.id,
              displayName: senderMap.get(m.senderId)!.displayName,
              username: senderMap.get(m.senderId)!.username,
              avatarUrl: senderMap.get(m.senderId)!.avatarUrl,
            }
          : null,
        attachments: attachments.filter((a) => a.messageId === m.id),
      })),
    });
  } catch (err) {
    console.error('GET /api/chats/:id/messages failed:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/:id/messages', requireAuth, uploadMiddleware.array('files', 5), async (req: AuthRequest, res) => {
  try {
    const chatId = Number(req.params.id);
    const userId = req.dbUser!.id;

    const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, chatId));
    if (!members.some((m) => m.userId === userId)) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }

    const { content, messageType, replyToId, forwardedFromId, locationData, encryptedPayload } = req.body || {};
    const files = (req.files as Express.Multer.File[]) || [];

    let parsedLocation: any = null;
    if (locationData) {
      const rawLoc = typeof locationData === 'string' ? JSON.parse(locationData) : locationData;
      const lat = Number(rawLoc?.lat);
      const lng = Number(rawLoc?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        parsedLocation = {
          lat,
          lng,
          label:
            typeof rawLoc?.label === 'string' && rawLoc.label.trim()
              ? rawLoc.label.trim().slice(0, 180)
              : `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          ...(rawLoc?.liveShareId ? { liveShareId: Number(rawLoc.liveShareId) } : {}),
          ...(typeof rawLoc?.isLive === 'boolean' ? { isLive: rawLoc.isLive } : {}),
          ...(typeof rawLoc?.expiresAt === 'string' ? { expiresAt: rawLoc.expiresAt } : {}),
          ...(rawLoc?.durationMinutes ? { durationMinutes: Number(rawLoc.durationMinutes) } : {}),
          ...(typeof rawLoc?.stopped === 'boolean' ? { stopped: rawLoc.stopped } : {}),
        };
      }
    }
    let parsedEncrypted = null;
    if (encryptedPayload) {
      parsedEncrypted = typeof encryptedPayload === 'string' ? JSON.parse(encryptedPayload) : encryptedPayload;
    }

    let resolvedType = messageType || 'text';
    if (files.length > 0 && !messageType) {
      const f = files[0];
      if (f.mimetype.startsWith('image/')) resolvedType = 'image';
      else if (f.mimetype.startsWith('video/')) resolvedType = 'video';
      else if (f.mimetype.startsWith('audio/')) resolvedType = 'audio';
      else resolvedType = 'document';
    }

    const [created] = await db
      .insert(messages)
      .values({
        chatId,
        senderId: userId,
        content: String(content || ''),
        messageType: resolvedType,
        replyToId: replyToId ? Number(replyToId) : null,
        forwardedFromId: forwardedFromId ? Number(forwardedFromId) : null,
        locationData: parsedLocation,
        encryptedPayload: parsedEncrypted,
        readBy: [userId],
        deliveredTo: members.map((m) => m.userId),
      })
      .returning();

    let savedAttachments: Array<typeof messageAttachments.$inferSelect> = [];
    if (files.length > 0) {
      savedAttachments = await db
        .insert(messageAttachments)
        .values(
          files.map((f) => ({
            messageId: created.id,
            fileName: f.originalname,
            mimeType: f.mimetype,
            fileSize: f.size,
            url: `/uploads/${f.filename}`,
          }))
        )
        .returning();
    }

    await db.update(chats).set({ lastMessageAt: new Date() }).where(eq(chats.id, chatId));

    const payload = {
      ...created,
      sender: {
        id: req.dbUser!.id,
        displayName: req.dbUser!.displayName,
        username: req.dbUser!.username,
        avatarUrl: req.dbUser!.avatarUrl,
      },
      attachments: savedAttachments,
    };

    const recipientIds = members.map((m) => m.userId).filter((id) => id !== userId);
    broadcastToUsers(members.map((m) => m.userId), 'chat:message', payload);

    for (const rid of recipientIds) {
      const mem = members.find((m) => m.userId === rid);
      if (!mem?.isMuted) {
        await createNotification({
          userId: rid,
          actorId: userId,
          type: 'message',
          title: 'رسالة جديدة',
          body: `${req.dbUser!.displayName}: ${resolvedType === 'encrypted' ? 'رسالة مشفرة' : (created.content || 'مرفق جديد').slice(0, 60)}`,
          entityType: 'chat',
          entityId: chatId,
        });
      }
    }

    res.status(201).json({ message: payload });
  } catch (err) {
    console.error('POST /api/chats/:id/messages failed:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.patch('/messages/:msgId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const msgId = Number(req.params.msgId);
    const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.senderId !== req.dbUser!.id) return res.status(403).json({ error: 'Not authorized' });

    const [updated] = await db
      .update(messages)
      .set({ content: String(req.body?.content || ''), isEdited: true, updatedAt: new Date() })
      .where(eq(messages.id, msgId))
      .returning();

    const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, msg.chatId));
    broadcastToUsers(members.map((m) => m.userId), 'chat:edit', updated);
    res.json({ message: updated });
  } catch (err) {
    console.error('PATCH /api/chats/messages/:msgId failed:', err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

router.delete('/messages/:msgId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const msgId = Number(req.params.msgId);
    const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.senderId !== req.dbUser!.id) return res.status(403).json({ error: 'Not authorized' });

    const [updated] = await db
      .update(messages)
      .set({ isDeleted: true, content: '', updatedAt: new Date() })
      .where(eq(messages.id, msgId))
      .returning();

    const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, msg.chatId));
    broadcastToUsers(members.map((m) => m.userId), 'chat:delete', updated);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/chats/messages/:msgId failed:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.post('/messages/:msgId/react', requireAuth, async (req: AuthRequest, res) => {
  try {
    const msgId = Number(req.params.msgId);
    const emoji = String(req.body?.emoji || '👍').slice(0, 8);
    const userId = req.dbUser!.id;

    const [msg] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const reactions = { ...(msg.reactions || {}) };
    const list = reactions[emoji] || [];
    if (list.includes(userId)) {
      reactions[emoji] = list.filter((id) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...list, userId];
    }

    const [updated] = await db
      .update(messages)
      .set({ reactions })
      .where(eq(messages.id, msgId))
      .returning();

    const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, msg.chatId));
    broadcastToUsers(members.map((m) => m.userId), 'chat:reaction', updated);
    res.json({ reactions: updated.reactions });
  } catch (err) {
    console.error('POST /api/chats/messages/:msgId/react failed:', err);
    res.status(500).json({ error: 'Failed to react' });
  }
});

router.patch('/:id/settings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const chatId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const { isPinned, isArchived, isMuted } = req.body || {};

    const updates: Record<string, unknown> = {};
    if (typeof isPinned === 'boolean') updates.isPinned = isPinned;
    if (typeof isArchived === 'boolean') updates.isArchived = isArchived;
    if (typeof isMuted === 'boolean') updates.isMuted = isMuted;

    const [updated] = await db
      .update(chatMembers)
      .set(updates)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
      .returning();

    res.json({ membership: updated });
  } catch (err) {
    console.error('PATCH /api/chats/:id/settings failed:', err);
    res.status(500).json({ error: 'Failed to update chat settings' });
  }
});

export default router;
