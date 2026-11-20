import { Router } from 'express';
import { eq, desc, inArray, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  posts,
  postMedia,
  postReactions,
  comments,
  commentReactions,
  shares,
  savedPosts,
  users,
  friends,
  followers,
  pages,
  groups,
  groupMembers,
  pageFollowers,
  reports,
} from '../../db/schema.ts';
import { requireAuth, optionalAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware } from '../upload.ts';
import { createNotification } from '../notify.ts';

const router = Router();

async function hydratePosts(rawPosts: Array<typeof posts.$inferSelect>, viewerId?: number) {
  if (rawPosts.length === 0) return [];
  const postIds = rawPosts.map((p) => p.id);
  const authorIds = Array.from(new Set(rawPosts.map((p) => p.authorId)));

  const [authors, mediaRows, reactionRows, commentRows, shareRows, savedRows, pageRows, groupRows] =
    await Promise.all([
      db.select().from(users).where(inArray(users.id, authorIds)),
      db.select().from(postMedia).where(inArray(postMedia.postId, postIds)),
      db.select().from(postReactions).where(inArray(postReactions.postId, postIds)),
      db.select().from(comments).where(inArray(comments.postId, postIds)).orderBy(comments.createdAt),
      db.select().from(shares).where(inArray(shares.postId, postIds)),
      viewerId
        ? db
            .select()
            .from(savedPosts)
            .where(and(inArray(savedPosts.postId, postIds), eq(savedPosts.userId, viewerId)))
        : Promise.resolve([]),
      db.select().from(pages),
      db.select().from(groups),
    ]);

  const commentAuthorIds = Array.from(new Set(commentRows.map((c) => c.authorId)));
  const commentAuthors =
    commentAuthorIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, commentAuthorIds))
      : [];

  const allUsersMap = new Map([...authors, ...commentAuthors].map((u) => [u.id, u]));
  const pagesMap = new Map(pageRows.map((p) => [p.id, p]));
  const groupsMap = new Map(groupRows.map((g) => [g.id, g]));
  const savedSet = new Set(savedRows.map((s) => s.postId));

  return rawPosts.map((p) => {
    const author = allUsersMap.get(p.authorId);
    const pMedia = mediaRows.filter((m) => m.postId === p.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const pReactions = reactionRows.filter((r) => r.postId === p.id);
    const reactionCounts: Record<string, number> = {};
    let myReaction: string | null = null;
    for (const r of pReactions) {
      reactionCounts[r.reactionType] = (reactionCounts[r.reactionType] || 0) + 1;
      if (viewerId && r.userId === viewerId) myReaction = r.reactionType;
    }

    const pComments = commentRows
      .filter((c) => c.postId === p.id)
      .map((c) => {
        const ca = allUsersMap.get(c.authorId);
        return {
          ...c,
          author: ca
            ? {
                id: ca.id,
                username: ca.username,
                displayName: ca.displayName,
                avatarUrl: ca.avatarUrl,
                isVerified: ca.isVerified,
              }
            : null,
        };
      });

    return {
      ...p,
      author: author
        ? {
            id: author.id,
            username: author.username,
            displayName: author.displayName,
            avatarUrl: author.avatarUrl,
            isVerified: author.isVerified,
          }
        : null,
      page: p.pageId ? pagesMap.get(p.pageId) || null : null,
      group: p.groupId ? groupsMap.get(p.groupId) || null : null,
      media: pMedia,
      reactionCounts,
      totalReactions: pReactions.length,
      myReaction,
      comments: pComments,
      commentsCount: pComments.length,
      sharesCount: shareRows.filter((s) => s.postId === p.id).length,
      isSaved: savedSet.has(p.id),
    };
  });
}

router.get('/feed', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const filter = String(req.query.filter || 'latest'); // 'latest' | 'friends' | 'trending' | 'suggested' | 'pages' | 'groups' | 'saved' | 'drafts'
    const sort = String(req.query.sort || 'latest'); // 'latest' | 'relevant'
    const search = String(req.query.q || '').trim().toLowerCase();
    const authorIdParam = req.query.authorId ? Number(req.query.authorId) : null;
    const groupIdParam = req.query.groupId ? Number(req.query.groupId) : null;
    const pageIdParam = req.query.pageId ? Number(req.query.pageId) : null;
    const viewerId = req.dbUser?.id;

    let rawPosts = await db
      .select()
      .from(posts)
      .orderBy(desc(posts.isPinned), desc(posts.createdAt))
      .limit(120);

    // Filter out drafts unless viewer explicitly asks for their own drafts
    if (filter === 'drafts') {
      if (!viewerId) return res.json({ posts: [] });
      rawPosts = rawPosts.filter((p) => p.isDraft && p.authorId === viewerId);
    } else {
      rawPosts = rawPosts.filter((p) => !p.isDraft);
    }

    // Privacy filtering
    let friendIds = new Set<number>();
    if (viewerId) {
      const frs = await db.select().from(friends).where(eq(friends.userId, viewerId));
      friendIds = new Set(frs.map((f) => f.friendId));
    }

    rawPosts = rawPosts.filter((p) => {
      if (p.privacy === 'public') return true;
      if (!viewerId) return false;
      if (p.authorId === viewerId) return true;
      if (p.privacy === 'friends') return friendIds.has(p.authorId);
      return false;
    });

    if (authorIdParam) {
      rawPosts = rawPosts.filter((p) => p.authorId === authorIdParam);
    }
    if (groupIdParam) {
      rawPosts = rawPosts.filter((p) => p.groupId === groupIdParam);
    }
    if (pageIdParam) {
      rawPosts = rawPosts.filter((p) => p.pageId === pageIdParam);
    }

    if (filter === 'friends' && viewerId) {
      const following = await db.select().from(followers).where(eq(followers.followerId, viewerId));
      const allowed = new Set([...friendIds, ...following.map((f) => f.followingId), viewerId]);
      rawPosts = rawPosts.filter((p) => allowed.has(p.authorId));
    } else if (filter === 'pages') {
      rawPosts = rawPosts.filter((p) => p.pageId !== null);
    } else if (filter === 'groups') {
      rawPosts = rawPosts.filter((p) => p.groupId !== null);
    } else if (filter === 'saved' && viewerId) {
      const saved = await db.select().from(savedPosts).where(eq(savedPosts.userId, viewerId));
      const savedIds = new Set(saved.map((s) => s.postId));
      rawPosts = rawPosts.filter((p) => savedIds.has(p.id));
    }

    if (search) {
      rawPosts = rawPosts.filter(
        (p) =>
          (p.content || '').toLowerCase().includes(search) ||
          p.hashtags.some((h) => h.toLowerCase().includes(search)) ||
          (p.location || '').toLowerCase().includes(search)
      );
    }

    let hydrated = await hydratePosts(rawPosts, viewerId);

    if (filter === 'trending' || sort === 'relevant') {
      hydrated = hydrated.sort((a, b) => {
        const scoreA = a.totalReactions * 2 + a.commentsCount * 3 + a.sharesCount * 4 + a.viewsCount * 0.1;
        const scoreB = b.totalReactions * 2 + b.commentsCount * 3 + b.sharesCount * 4 + b.viewsCount * 0.1;
        return scoreB - scoreA;
      });
    }

    res.json({ posts: hydrated });
  } catch (err) {
    console.error('GET /api/social/feed failed:', err);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

router.post('/upload-media', requireAuth, uploadMiddleware.array('files', 10), async (req: AuthRequest, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const uploaded = files.map((f) => ({
      url: `/uploads/${f.filename}`,
      fileName: f.originalname,
      mimeType: f.mimetype,
      fileSize: f.size,
      mediaType: f.mimetype.startsWith('image/')
        ? 'image'
        : f.mimetype.startsWith('video/')
        ? 'video'
        : f.mimetype === 'application/pdf'
        ? 'pdf'
        : 'file',
    }));
    res.json({ media: uploaded });
  } catch (err) {
    console.error('POST /api/social/upload-media failed:', err);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

router.post('/posts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const {
      content,
      postType,
      backgroundStyle,
      linkUrl,
      linkTitle,
      location,
      locationData,
      hashtags,
      mentions,
      pollOptions,
      privacy,
      isDraft,
      pageId,
      groupId,
      media,
    } = req.body || {};

    let sanitizedLocationData: { lat: number; lng: number; label: string } | null = null;
    if (locationData && typeof locationData === 'object') {
      const lat = Number((locationData as any).lat);
      const lng = Number((locationData as any).lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        const label =
          typeof (locationData as any).label === 'string' && (locationData as any).label.trim()
            ? (locationData as any).label.trim().slice(0, 180)
            : typeof location === 'string' && location.trim()
            ? location.trim().slice(0, 180)
            : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        sanitizedLocationData = { lat, lng, label };
      }
    }

    if (pageId) {
      const [page] = await db.select().from(pages).where(eq(pages.id, Number(pageId))).limit(1);
      if (!page) return res.status(404).json({ error: 'Page not found' });
      const [roleRow] = await db
        .select()
        .from(pageFollowers)
        .where(and(eq(pageFollowers.pageId, page.id), eq(pageFollowers.userId, userId)))
        .limit(1);
      if (page.ownerId !== userId && roleRow?.role !== 'admin' && roleRow?.role !== 'editor') {
        return res.status(403).json({ error: 'Not authorized to post on this page' });
      }
    }

    if (groupId) {
      const [member] = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, Number(groupId)), eq(groupMembers.userId, userId)))
        .limit(1);
      if (!member || member.status !== 'active') {
        return res.status(403).json({ error: 'Join this group before posting' });
      }
    }

    const formattedPoll = Array.isArray(pollOptions)
      ? pollOptions
          .filter((o: any) => typeof o === 'string' && o.trim())
          .slice(0, 6)
          .map((text: string, idx: number) => ({
            id: `opt_${idx}_${Date.now()}`,
            text: text.trim(),
            voterIds: [],
          }))
      : null;

    const extractedTags = Array.isArray(hashtags)
      ? hashtags
      : String(content || '')
          .match(/#[\p{L}\p{N}_]+/gu)
          ?.map((t) => t.slice(1)) || [];

    const extractedMentions = Array.isArray(mentions)
      ? mentions
      : String(content || '')
          .match(/@[a-zA-Z0-9_]+/g)
          ?.map((m) => m.slice(1)) || [];

    const [created] = await db
      .insert(posts)
      .values({
        authorId: userId,
        pageId: pageId ? Number(pageId) : null,
        groupId: groupId ? Number(groupId) : null,
        content: String(content || ''),
        postType: postType || 'text',
        backgroundStyle: backgroundStyle || null,
        linkUrl: linkUrl || null,
        linkTitle: linkTitle || null,
        location: (typeof location === 'string' && location.trim()) || sanitizedLocationData?.label || null,
        locationData: sanitizedLocationData,
        hashtags: extractedTags,
        mentions: extractedMentions,
        pollOptions: formattedPoll,
        privacy: privacy || 'public',
        isDraft: Boolean(isDraft),
      })
      .returning();

    if (Array.isArray(media) && media.length > 0) {
      await db.insert(postMedia).values(
        media.map((m: any, idx: number) => ({
          postId: created.id,
          mediaType: m.mediaType || 'image',
          url: m.url,
          fileName: m.fileName || null,
          mimeType: m.mimeType || null,
          fileSize: m.fileSize || null,
          sortOrder: idx,
        }))
      );
    }

    // Notify mentioned users
    if (!created.isDraft && extractedMentions.length > 0) {
      const mentionedUsers = await db
        .select()
        .from(users)
        .where(inArray(users.username, extractedMentions));
      for (const mu of mentionedUsers) {
        await createNotification({
          userId: mu.id,
          actorId: userId,
          type: 'mention',
          title: 'إشارة جديدة',
          body: `${req.dbUser!.displayName} أشار إليك في منشور`,
          entityType: 'post',
          entityId: created.id,
        });
      }
    }

    const [hydrated] = await hydratePosts([created], userId);
    res.status(201).json({ post: hydrated });
  } catch (err) {
    console.error('POST /api/social/posts failed:', err);
    res.status(500).json({ error: 'Failed to publish post' });
  }
});

router.patch('/posts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const [existing] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (existing.authorId !== req.dbUser!.id && req.dbUser!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to edit this post' });
    }

    const { content, privacy, isPinned, commentsDisabled, isDraft } = req.body || {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof content === 'string') updates.content = content;
    if (typeof privacy === 'string') updates.privacy = privacy;
    if (typeof isPinned === 'boolean') updates.isPinned = isPinned;
    if (typeof commentsDisabled === 'boolean') updates.commentsDisabled = commentsDisabled;
    if (typeof isDraft === 'boolean') updates.isDraft = isDraft;

    const [updated] = await db.update(posts).set(updates).where(eq(posts.id, postId)).returning();
    const [hydrated] = await hydratePosts([updated], req.dbUser!.id);
    res.json({ post: hydrated });
  } catch (err) {
    console.error('PATCH /api/social/posts/:id failed:', err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.delete('/posts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const [existing] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (existing.authorId !== req.dbUser!.id && req.dbUser!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await db.delete(posts).where(eq(posts.id, postId));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/social/posts/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

router.post('/posts/:id/view', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    await db
      .update(posts)
      .set({ viewsCount: sql`${posts.viewsCount} + 1` })
      .where(eq(posts.id, postId));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to record view' });
  }
});

router.post('/posts/:id/react', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const reactionType = String(req.body?.reactionType || 'like');
    const valid = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
    if (!valid.includes(reactionType)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const [existing] = await db
      .select()
      .from(postReactions)
      .where(and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)))
      .limit(1);

    if (existing) {
      if (existing.reactionType === reactionType) {
        await db.delete(postReactions).where(eq(postReactions.id, existing.id));
        return res.json({ removed: true });
      }
      await db
        .update(postReactions)
        .set({ reactionType })
        .where(eq(postReactions.id, existing.id));
    } else {
      await db.insert(postReactions).values({ postId, userId, reactionType });
      await createNotification({
        userId: post.authorId,
        actorId: userId,
        type: 'reaction',
        title: 'تفاعل جديد',
        body: `${req.dbUser!.displayName} تفاعل مع منشورك`,
        entityType: 'post',
        entityId: postId,
      });
    }

    res.json({ ok: true, reactionType });
  } catch (err) {
    console.error('POST /api/social/posts/:id/react failed:', err);
    res.status(500).json({ error: 'Failed to react to post' });
  }
});

router.post('/posts/:id/poll-vote', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const optionId = String(req.body?.optionId || '');
    const userId = req.dbUser!.id;

    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post || !post.pollOptions) return res.status(404).json({ error: 'Poll not found' });

    const updatedOptions = post.pollOptions.map((opt) => {
      const cleanVoters = (opt.voterIds || []).filter((id) => id !== userId);
      if (opt.id === optionId) cleanVoters.push(userId);
      return { ...opt, voterIds: cleanVoters };
    });

    const [updated] = await db
      .update(posts)
      .set({ pollOptions: updatedOptions })
      .where(eq(posts.id, postId))
      .returning();

    res.json({ pollOptions: updated.pollOptions });
  } catch (err) {
    console.error('POST /api/social/posts/:id/poll-vote failed:', err);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

router.post('/posts/:id/comments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const { content, parentId, imageUrl } = req.body || {};
    if (!content?.trim() && !imageUrl) {
      return res.status(400).json({ error: 'Comment content required' });
    }

    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.commentsDisabled) return res.status(403).json({ error: 'Comments are disabled on this post' });

    const [created] = await db
      .insert(comments)
      .values({
        postId,
        authorId: req.dbUser!.id,
        parentId: parentId ? Number(parentId) : null,
        content: String(content || '').trim(),
        imageUrl: imageUrl || null,
      })
      .returning();

    await createNotification({
      userId: post.authorId,
      actorId: req.dbUser!.id,
      type: 'comment',
      title: 'تعليق جديد',
      body: `${req.dbUser!.displayName} علّق على منشورك`,
      entityType: 'post',
      entityId: postId,
    });

    res.status(201).json({
      comment: {
        ...created,
        author: {
          id: req.dbUser!.id,
          username: req.dbUser!.username,
          displayName: req.dbUser!.displayName,
          avatarUrl: req.dbUser!.avatarUrl,
          isVerified: req.dbUser!.isVerified,
        },
      },
    });
  } catch (err) {
    console.error('POST /api/social/posts/:id/comments failed:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

router.delete('/comments/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const commentId = Number(req.params.id);
    const [c] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    if (!c) return res.status(404).json({ error: 'Comment not found' });

    const [post] = await db.select().from(posts).where(eq(posts.id, c.postId)).limit(1);
    if (c.authorId !== req.dbUser!.id && post?.authorId !== req.dbUser!.id && req.dbUser!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }
    await db.delete(comments).where(eq(comments.id, commentId));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/social/comments/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

router.post('/comments/:id/react', requireAuth, async (req: AuthRequest, res) => {
  try {
    const commentId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [existing] = await db
      .select()
      .from(commentReactions)
      .where(and(eq(commentReactions.commentId, commentId), eq(commentReactions.userId, userId)))
      .limit(1);

    if (existing) {
      await db.delete(commentReactions).where(eq(commentReactions.id, existing.id));
      return res.json({ liked: false });
    }
    await db.insert(commentReactions).values({ commentId, userId, reactionType: 'like' });
    res.json({ liked: true });
  } catch (err) {
    console.error('POST /api/social/comments/:id/react failed:', err);
    res.status(500).json({ error: 'Failed to react to comment' });
  }
});

router.post('/posts/:id/share', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const [share] = await db
      .insert(shares)
      .values({ postId, userId: req.dbUser!.id, comment: String(req.body?.comment || '') })
      .returning();

    await createNotification({
      userId: post.authorId,
      actorId: req.dbUser!.id,
      type: 'share',
      title: 'مشاركة منشور',
      body: `${req.dbUser!.displayName} شارك منشورك`,
      entityType: 'post',
      entityId: postId,
    });

    res.json({ share });
  } catch (err) {
    console.error('POST /api/social/posts/:id/share failed:', err);
    res.status(500).json({ error: 'Failed to share post' });
  }
});

router.post('/posts/:id/save', requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [existing] = await db
      .select()
      .from(savedPosts)
      .where(and(eq(savedPosts.postId, postId), eq(savedPosts.userId, userId)))
      .limit(1);

    if (existing) {
      await db.delete(savedPosts).where(eq(savedPosts.id, existing.id));
      return res.json({ saved: false });
    }
    await db.insert(savedPosts).values({ postId, userId });
    res.json({ saved: true });
  } catch (err) {
    console.error('POST /api/social/posts/:id/save failed:', err);
    res.status(500).json({ error: 'Failed to save post' });
  }
});

router.post('/reports', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { targetType, targetId, reason } = req.body || {};
    if (!targetType || !targetId || !reason?.trim()) {
      return res.status(400).json({ error: 'Target type, target id, and reason are required' });
    }
    const [created] = await db
      .insert(reports)
      .values({
        reporterId: req.dbUser!.id,
        targetType: String(targetType),
        targetId: Number(targetId),
        reason: String(reason).trim().slice(0, 500),
      })
      .returning();
    res.status(201).json({ report: created });
  } catch (err) {
    console.error('POST /api/social/reports failed:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

export default router;
