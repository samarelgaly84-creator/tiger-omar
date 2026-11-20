import { Router } from 'express';
import { eq, desc, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { liveStreams, users, followers } from '../../db/schema.ts';
import { requireAuth, optionalAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware } from '../upload.ts';
import { createNotification } from '../notify.ts';

const router = Router();

router.get('/', optionalAuth, async (_req, res) => {
  try {
    const list = await db.select().from(liveStreams).orderBy(desc(liveStreams.createdAt)).limit(30);
    if (list.length === 0) return res.json({ streams: [] });
    const hostIds = Array.from(new Set(list.map((s) => s.hostId)));
    const hosts = await db.select().from(users).where(inArray(users.id, hostIds));
    const hostMap = new Map(hosts.map((h) => [h.id, h]));

    res.json({
      streams: list.map((s) => ({
        ...s,
        host: hostMap.get(s.hostId)
          ? {
              id: hostMap.get(s.hostId)!.id,
              displayName: hostMap.get(s.hostId)!.displayName,
              username: hostMap.get(s.hostId)!.username,
              avatarUrl: hostMap.get(s.hostId)!.avatarUrl,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error('GET /api/live failed:', err);
    res.status(500).json({ error: 'Failed to fetch live streams' });
  }
});

router.post('/start', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'Stream title required' });

    const [stream] = await db
      .insert(liveStreams)
      .values({
        hostId: req.dbUser!.id,
        title: String(title).trim().slice(0, 120),
        description: String(description || '').slice(0, 500),
        status: 'live',
      })
      .returning();

    // Notify followers
    const followerRows = await db
      .select()
      .from(followers)
      .where(eq(followers.followingId, req.dbUser!.id));
    for (const f of followerRows.slice(0, 25)) {
      await createNotification({
        userId: f.followerId,
        actorId: req.dbUser!.id,
        type: 'live',
        title: 'بث مباشر الآن',
        body: `${req.dbUser!.displayName} بدأ بثاً مباشراً: ${stream.title}`,
        entityType: 'live',
        entityId: stream.id,
      });
    }

    res.status(201).json({ stream });
  } catch (err) {
    console.error('POST /api/live/start failed:', err);
    res.status(500).json({ error: 'Failed to start live stream' });
  }
});

router.post('/:id/end', requireAuth, uploadMiddleware.single('recording'), async (req: AuthRequest, res) => {
  try {
    const streamId = Number(req.params.id);
    const [stream] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId)).limit(1);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    if (stream.hostId !== req.dbUser!.id && req.dbUser!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const recordingUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const [updated] = await db
      .update(liveStreams)
      .set({ status: 'ended', endedAt: new Date(), recordingUrl })
      .where(eq(liveStreams.id, streamId))
      .returning();

    res.json({ stream: updated });
  } catch (err) {
    console.error('POST /api/live/:id/end failed:', err);
    res.status(500).json({ error: 'Failed to end live stream' });
  }
});

export default router;
