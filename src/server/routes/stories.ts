import { Router } from 'express';
import { eq, gt, desc, inArray, and } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { stories, storyViews, users } from '../../db/schema.ts';
import { requireAuth, optionalAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware } from '../upload.ts';
import { createNotification } from '../notify.ts';

const router = Router();

router.get('/', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const activeStories = await db
      .select()
      .from(stories)
      .where(gt(stories.expiresAt, now))
      .orderBy(desc(stories.createdAt));

    if (activeStories.length === 0) return res.json({ stories: [] });

    const authorIds = Array.from(new Set(activeStories.map((s) => s.authorId)));
    const storyIds = activeStories.map((s) => s.id);

    const [authors, views] = await Promise.all([
      db.select().from(users).where(inArray(users.id, authorIds)),
      db.select().from(storyViews).where(inArray(storyViews.storyId, storyIds)),
    ]);

    const viewerIds = Array.from(new Set(views.map((v) => v.viewerId)));
    const viewerUsers =
      viewerIds.length > 0 ? await db.select().from(users).where(inArray(users.id, viewerIds)) : [];
    const userMap = new Map([...authors, ...viewerUsers].map((u) => [u.id, u]));

    const enriched = activeStories.map((s) => {
      const sViews = views.filter((v) => v.storyId === s.id);
      const author = userMap.get(s.authorId);
      return {
        ...s,
        author: author
          ? {
              id: author.id,
              username: author.username,
              displayName: author.displayName,
              avatarUrl: author.avatarUrl,
            }
          : null,
        viewsCount: sViews.length,
        viewers:
          req.dbUser?.id === s.authorId
            ? sViews.map((v) => ({
                viewerId: v.viewerId,
                displayName: userMap.get(v.viewerId)?.displayName || 'User',
                avatarUrl: userMap.get(v.viewerId)?.avatarUrl || null,
                replyText: v.replyText,
                viewedAt: v.viewedAt,
              }))
            : [],
      };
    });

    res.json({ stories: enriched });
  } catch (err) {
    console.error('GET /api/stories failed:', err);
    res.status(500).json({ error: 'Failed to load stories' });
  }
});

router.post('/', requireAuth, uploadMiddleware.single('media'), async (req: AuthRequest, res) => {
  try {
    const { textOverlay, backgroundColor, stickers, musicTitle, privacy } = req.body || {};
    const file = req.file;
    const mediaUrl = file ? `/uploads/${file.filename}` : req.body?.mediaUrl || null;
    const mediaType = file
      ? file.mimetype.startsWith('video/')
        ? 'video'
        : 'image'
      : mediaUrl
      ? 'image'
      : 'text';

    let parsedStickers = [];
    if (typeof stickers === 'string') {
      try {
        parsedStickers = JSON.parse(stickers);
      } catch {
        parsedStickers = [];
      }
    } else if (Array.isArray(stickers)) {
      parsedStickers = stickers;
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [created] = await db
      .insert(stories)
      .values({
        authorId: req.dbUser!.id,
        mediaUrl,
        mediaType,
        textOverlay: String(textOverlay || ''),
        backgroundColor: String(backgroundColor || '#18181b'),
        stickers: parsedStickers,
        musicTitle: musicTitle ? String(musicTitle) : null,
        privacy: privacy === 'friends' ? 'friends' : 'public',
        expiresAt,
      })
      .returning();

    res.status(201).json({ story: created });
  } catch (err) {
    console.error('POST /api/stories failed:', err);
    res.status(500).json({ error: 'Failed to publish story' });
  }
});

router.post('/:id/view', requireAuth, async (req: AuthRequest, res) => {
  try {
    const storyId = Number(req.params.id);
    const viewerId = req.dbUser!.id;
    const replyText = req.body?.replyText ? String(req.body.replyText).slice(0, 300) : null;

    const [story] = await db.select().from(stories).where(eq(stories.id, storyId)).limit(1);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const [existing] = await db
      .select()
      .from(storyViews)
      .where(and(eq(storyViews.storyId, storyId), eq(storyViews.viewerId, viewerId)))
      .limit(1);

    if (existing) {
      if (replyText) {
        await db.update(storyViews).set({ replyText }).where(eq(storyViews.id, existing.id));
      }
    } else {
      await db.insert(storyViews).values({ storyId, viewerId, replyText });
    }

    if (replyText) {
      await createNotification({
        userId: story.authorId,
        actorId: viewerId,
        type: 'comment',
        title: 'رد على قصتك',
        body: `${req.dbUser!.displayName}: ${replyText}`,
        entityType: 'story',
        entityId: storyId,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/stories/:id/view failed:', err);
    res.status(500).json({ error: 'Failed to record story view' });
  }
});

router.patch('/:id/highlight', requireAuth, async (req: AuthRequest, res) => {
  try {
    const storyId = Number(req.params.id);
    const [story] = await db.select().from(stories).where(eq(stories.id, storyId)).limit(1);
    if (!story || story.authorId !== req.dbUser!.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const [updated] = await db
      .update(stories)
      .set({ isHighlighted: !story.isHighlighted })
      .where(eq(stories.id, storyId))
      .returning();
    res.json({ story: updated });
  } catch (err) {
    console.error('PATCH /api/stories/:id/highlight failed:', err);
    res.status(500).json({ error: 'Failed to update highlight' });
  }
});

export default router;
