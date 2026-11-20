import { Router } from 'express';
import { eq, desc, inArray, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { reels, reelViews, reelComments, users, followers } from '../../db/schema.ts';
import { requireAuth, optionalAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware } from '../upload.ts';
import { createNotification } from '../notify.ts';

const router = Router();

router.get('/', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const viewerId = req.dbUser?.id;
    const allReels = await db.select().from(reels).orderBy(desc(reels.createdAt)).limit(50);
    if (allReels.length === 0) return res.json({ reels: [] });

    const authorIds = Array.from(new Set(allReels.map((r) => r.authorId)));
    const reelIds = allReels.map((r) => r.id);

    const [authors, viewerInteractions, commentsRows, followingRows] = await Promise.all([
      db.select().from(users).where(inArray(users.id, authorIds)),
      viewerId
        ? db.select().from(reelViews).where(and(inArray(reelViews.reelId, reelIds), eq(reelViews.viewerId, viewerId)))
        : Promise.resolve([]),
      db.select().from(reelComments).where(inArray(reelComments.reelId, reelIds)).orderBy(desc(reelComments.createdAt)),
      viewerId
        ? db.select().from(followers).where(eq(followers.followerId, viewerId))
        : Promise.resolve([]),
    ]);

    const commentAuthorIds = Array.from(new Set(commentsRows.map((c) => c.authorId)));
    const commentAuthors =
      commentAuthorIds.length > 0
        ? await db.select().from(users).where(inArray(users.id, commentAuthorIds))
        : [];

    const userMap = new Map([...authors, ...commentAuthors].map((u) => [u.id, u]));
    const interactionMap = new Map(viewerInteractions.map((v) => [v.reelId, v]));
    const followingSet = new Set(followingRows.map((f) => f.followingId));

    const enriched = allReels.map((r) => {
      const author = userMap.get(r.authorId);
      const interaction = interactionMap.get(r.id);
      const rComments = commentsRows
        .filter((c) => c.reelId === r.id)
        .map((c) => ({
          ...c,
          author: userMap.get(c.authorId)
            ? {
                id: userMap.get(c.authorId)!.id,
                displayName: userMap.get(c.authorId)!.displayName,
                username: userMap.get(c.authorId)!.username,
                avatarUrl: userMap.get(c.authorId)!.avatarUrl,
              }
            : null,
        }));

      return {
        ...r,
        author: author
          ? {
              id: author.id,
              username: author.username,
              displayName: author.displayName,
              avatarUrl: author.avatarUrl,
              isVerified: author.isVerified,
              isFollowing: followingSet.has(author.id),
            }
          : null,
        liked: interaction?.liked || false,
        saved: interaction?.saved || false,
        comments: rComments,
      };
    });

    res.json({ reels: enriched });
  } catch (err) {
    console.error('GET /api/reels failed:', err);
    res.status(500).json({ error: 'Failed to load reels' });
  }
});

router.post('/', requireAuth, uploadMiddleware.single('video'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Video file is required' });
    const caption = String(req.body?.caption || '');
    const musicTitle = String(req.body?.musicTitle || 'Original Audio');
    const hashtags =
      caption.match(/#[\p{L}\p{N}_]+/gu)?.map((t) => t.slice(1)) || [];

    const [created] = await db
      .insert(reels)
      .values({
        authorId: req.dbUser!.id,
        videoUrl: `/uploads/${req.file.filename}`,
        caption,
        hashtags,
        musicTitle,
      })
      .returning();

    res.status(201).json({ reel: created });
  } catch (err) {
    console.error('POST /api/reels failed:', err);
    res.status(500).json({ error: 'Failed to upload reel' });
  }
});

router.post('/:id/view', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const reelId = Number(req.params.id);
    await db.update(reels).set({ viewsCount: sql`${reels.viewsCount} + 1` }).where(eq(reels.id, reelId));
    if (req.dbUser) {
      await db
        .insert(reelViews)
        .values({ reelId, viewerId: req.dbUser.id })
        .onConflictDoNothing();
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to track view' });
  }
});

router.post('/:id/like', requireAuth, async (req: AuthRequest, res) => {
  try {
    const reelId = Number(req.params.id);
    const viewerId = req.dbUser!.id;
    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId)).limit(1);
    if (!reel) return res.status(404).json({ error: 'Reel not found' });

    const [existing] = await db
      .select()
      .from(reelViews)
      .where(and(eq(reelViews.reelId, reelId), eq(reelViews.viewerId, viewerId)))
      .limit(1);

    let liked = true;
    if (existing) {
      liked = !existing.liked;
      await db.update(reelViews).set({ liked }).where(eq(reelViews.id, existing.id));
    } else {
      await db.insert(reelViews).values({ reelId, viewerId, liked: true });
    }

    await db
      .update(reels)
      .set({ likesCount: sql`GREATEST(0, ${reels.likesCount} + ${liked ? 1 : -1})` })
      .where(eq(reels.id, reelId));

    if (liked) {
      await createNotification({
        userId: reel.authorId,
        actorId: viewerId,
        type: 'reaction',
        title: 'إعجاب بفيديو Reels',
        body: `${req.dbUser!.displayName} أعجب بفيديو الخاص بك`,
        entityType: 'reel',
        entityId: reelId,
      });
    }

    res.json({ liked });
  } catch (err) {
    console.error('POST /api/reels/:id/like failed:', err);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

router.post('/:id/save', requireAuth, async (req: AuthRequest, res) => {
  try {
    const reelId = Number(req.params.id);
    const viewerId = req.dbUser!.id;
    const [existing] = await db
      .select()
      .from(reelViews)
      .where(and(eq(reelViews.reelId, reelId), eq(reelViews.viewerId, viewerId)))
      .limit(1);

    let saved = true;
    if (existing) {
      saved = !existing.saved;
      await db.update(reelViews).set({ saved }).where(eq(reelViews.id, existing.id));
    } else {
      await db.insert(reelViews).values({ reelId, viewerId, saved: true });
    }
    res.json({ saved });
  } catch (err) {
    console.error('POST /api/reels/:id/save failed:', err);
    res.status(500).json({ error: 'Failed to save reel' });
  }
});

router.post('/:id/comments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const reelId = Number(req.params.id);
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Comment required' });

    const [created] = await db
      .insert(reelComments)
      .values({ reelId, authorId: req.dbUser!.id, content })
      .returning();

    await db
      .update(reels)
      .set({ commentsCount: sql`${reels.commentsCount} + 1` })
      .where(eq(reels.id, reelId));

    res.status(201).json({
      comment: {
        ...created,
        author: {
          id: req.dbUser!.id,
          displayName: req.dbUser!.displayName,
          username: req.dbUser!.username,
          avatarUrl: req.dbUser!.avatarUrl,
        },
      },
    });
  } catch (err) {
    console.error('POST /api/reels/:id/comments failed:', err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

export default router;
