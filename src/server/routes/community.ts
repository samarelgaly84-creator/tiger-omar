import { Router } from 'express';
import { eq, desc, and, or, ilike, ne, sql, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  users,
  profiles,
  friends,
  friendRequests,
  followers,
  blockedUsers,
  groups,
  groupMembers,
  pages,
  pageFollowers,
  chats,
  chatMembers,
} from '../../db/schema.ts';
import { requireAuth, optionalAuth, AuthRequest } from '../../middleware/auth.ts';
import { createNotification } from '../notify.ts';

const router = Router();

// --- USERS & PROFILE ---
router.get('/users/search', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const rawQ = String(req.query.q || '').trim();
    const handleQ = rawQ.replace(/^@+/, '').trim();
    const excludeSelf = req.query.excludeSelf === 'true' && Boolean(req.dbUser?.id);

    let whereClause: any = eq(users.isBanned, false);
    if (rawQ) {
      const searchToken = handleQ || rawQ;
      const patterns = [
        ilike(users.displayName, `%${rawQ}%`),
        ilike(users.username, `%${searchToken}%`),
        ilike(users.email, `%${searchToken}%`),
      ];
      if (handleQ && handleQ !== rawQ) {
        patterns.push(ilike(users.displayName, `%${handleQ}%`));
      }
      whereClause = and(eq(users.isBanned, false), or(...patterns));
    }

    if (excludeSelf && req.dbUser) {
      whereClause = and(whereClause, ne(users.id, req.dbUser.id));
    }

    const list = await db
      .select()
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.isOnline), desc(users.lastSeenAt))
      .limit(30);

    res.json({
      users: list.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        isOnline: u.isOnline,
        lastSeenAt: u.lastSeenAt,
        isVerified: u.isVerified,
        publicKeyJwk: u.publicKeyJwk,
      })),
    });
  } catch (err) {
    console.error('GET /api/community/users/search failed:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/users/:id', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    const [u] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, targetId)).limit(1);
    const [friendsRows, followersRows, followingRows] = await Promise.all([
      db.select().from(friends).where(eq(friends.userId, targetId)),
      db.select().from(followers).where(eq(followers.followingId, targetId)),
      db.select().from(followers).where(eq(followers.followerId, targetId)),
    ]);

    let isFriend = false;
    let isFollowing = false;
    if (req.dbUser) {
      isFriend = friendsRows.some((f) => f.friendId === req.dbUser!.id);
      isFollowing = followersRows.some((f) => f.followerId === req.dbUser!.id);
    }

    res.json({
      user: {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        coverUrl: u.coverUrl,
        bio: u.bio,
        isOnline: u.isOnline,
        lastSeenAt: u.lastSeenAt,
        isVerified: u.isVerified,
        createdAt: u.createdAt,
      },
      profile: profile || null,
      stats: {
        friendsCount: friendsRows.length,
        followersCount: followersRows.length,
        followingCount: followingRows.length,
      },
      isFriend,
      isFollowing,
    });
  } catch (err) {
    console.error('GET /api/community/users/:id failed:', err);
    res.status(500).json({ error: 'Failed to load user profile' });
  }
});

// --- FRIENDS & REQUESTS & FOLLOWERS & BLOCKS ---
router.get('/friends', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const [friendRows, incomingRequests, outgoingRequests, blockedRows, allUsers] = await Promise.all([
      db.select().from(friends).where(eq(friends.userId, userId)),
      db
        .select()
        .from(friendRequests)
        .where(and(eq(friendRequests.receiverId, userId), eq(friendRequests.status, 'pending'))),
      db
        .select()
        .from(friendRequests)
        .where(and(eq(friendRequests.senderId, userId), eq(friendRequests.status, 'pending'))),
      db.select().from(blockedUsers).where(eq(blockedUsers.userId, userId)),
      db.select().from(users).where(ne(users.id, userId)).limit(40),
    ]);

    const friendIdSet = new Set(friendRows.map((f) => f.friendId));
    const blockedIdSet = new Set(blockedRows.map((b) => b.blockedUserId));
    const pendingIds = new Set([
      ...incomingRequests.map((r) => r.senderId),
      ...outgoingRequests.map((r) => r.receiverId),
    ]);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const pickSafe = (u: typeof users.$inferSelect) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
      isOnline: u.isOnline,
      lastSeenAt: u.lastSeenAt,
      isVerified: u.isVerified,
    });

    res.json({
      friends: friendRows.map((f) => userMap.get(f.friendId)).filter(Boolean).map((u) => pickSafe(u!)),
      incomingRequests: incomingRequests.map((r) => ({
        ...r,
        sender: userMap.get(r.senderId) ? pickSafe(userMap.get(r.senderId)!) : null,
      })),
      outgoingRequests: outgoingRequests.map((r) => ({
        ...r,
        receiver: userMap.get(r.receiverId) ? pickSafe(userMap.get(r.receiverId)!) : null,
      })),
      suggestions: allUsers
        .filter((u) => !friendIdSet.has(u.id) && !blockedIdSet.has(u.id) && !pendingIds.has(u.id))
        .slice(0, 15)
        .map(pickSafe),
      blocked: blockedRows.map((b) => userMap.get(b.blockedUserId)).filter(Boolean).map((u) => pickSafe(u!)),
    });
  } catch (err) {
    console.error('GET /api/community/friends failed:', err);
    res.status(500).json({ error: 'Failed to load friends data' });
  }
});

router.post('/friends/request', requireAuth, async (req: AuthRequest, res) => {
  try {
    const senderId = req.dbUser!.id;
    const receiverId = Number(req.body?.receiverId);
    if (!receiverId || receiverId === senderId) return res.status(400).json({ error: 'Invalid user' });

    const [created] = await db
      .insert(friendRequests)
      .values({ senderId, receiverId, status: 'pending' })
      .returning();

    await createNotification({
      userId: receiverId,
      actorId: senderId,
      type: 'friend_request',
      title: 'طلب صداقة جديد',
      body: `${req.dbUser!.displayName} أرسل لك طلب صداقة`,
      entityType: 'user',
      entityId: senderId,
    });

    res.status(201).json({ request: created });
  } catch (err) {
    console.error('POST /api/community/friends/request failed:', err);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

router.post('/friends/respond', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { requestId, action } = req.body || {}; // 'accept' | 'reject'
    const [request] = await db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.id, Number(requestId)), eq(friendRequests.receiverId, userId)))
      .limit(1);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (action === 'accept') {
      await db.update(friendRequests).set({ status: 'accepted' }).where(eq(friendRequests.id, request.id));
      await db
        .insert(friends)
        .values([
          { userId, friendId: request.senderId },
          { userId: request.senderId, friendId: userId },
        ])
        .onConflictDoNothing();

      await createNotification({
        userId: request.senderId,
        actorId: userId,
        type: 'friend_request',
        title: 'تم قبول طلب الصداقة',
        body: `${req.dbUser!.displayName} قبل طلب صداقتك`,
        entityType: 'user',
        entityId: userId,
      });
    } else {
      await db.update(friendRequests).set({ status: 'rejected' }).where(eq(friendRequests.id, request.id));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/community/friends/respond failed:', err);
    res.status(500).json({ error: 'Failed to respond to request' });
  }
});

router.delete('/friends/:friendId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const friendId = Number(req.params.friendId);
    await db
      .delete(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
          and(eq(friends.userId, friendId), eq(friends.friendId, userId))
        )
      );
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/community/friends/:friendId failed:', err);
    res.status(500).json({ error: 'Failed to unfriend' });
  }
});

router.post('/follow/:targetId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const followerId = req.dbUser!.id;
    const followingId = Number(req.params.targetId);
    if (followerId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const [existing] = await db
      .select()
      .from(followers)
      .where(and(eq(followers.followerId, followerId), eq(followers.followingId, followingId)))
      .limit(1);

    if (existing) {
      await db.delete(followers).where(eq(followers.id, existing.id));
      return res.json({ following: false });
    }

    await db.insert(followers).values({ followerId, followingId });
    await createNotification({
      userId: followingId,
      actorId: followerId,
      type: 'follow',
      title: 'متابع جديد',
      body: `${req.dbUser!.displayName} بدأ بمتابعتك`,
      entityType: 'user',
      entityId: followerId,
    });
    res.json({ following: true });
  } catch (err) {
    console.error('POST /api/community/follow/:targetId failed:', err);
    res.status(500).json({ error: 'Failed to update follow status' });
  }
});

router.post('/block/:targetId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const blockedUserId = Number(req.params.targetId);

    const [existing] = await db
      .select()
      .from(blockedUsers)
      .where(and(eq(blockedUsers.userId, userId), eq(blockedUsers.blockedUserId, blockedUserId)))
      .limit(1);

    if (existing) {
      await db.delete(blockedUsers).where(eq(blockedUsers.id, existing.id));
      return res.json({ blocked: false });
    }

    await db.insert(blockedUsers).values({ userId, blockedUserId });
    await db
      .delete(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.friendId, blockedUserId)),
          and(eq(friends.userId, blockedUserId), eq(friends.friendId, userId))
        )
      );
    res.json({ blocked: true });
  } catch (err) {
    console.error('POST /api/community/block/:targetId failed:', err);
    res.status(500).json({ error: 'Failed to update block status' });
  }
});

// --- GROUPS ---
router.get('/groups', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const allGroups = await db.select().from(groups).orderBy(desc(groups.createdAt));
    const members = await db.select().from(groupMembers);
    const viewerId = req.dbUser?.id;

    res.json({
      groups: allGroups.map((g) => {
        const gMembers = members.filter((m) => m.groupId === g.id);
        const myMem = viewerId ? gMembers.find((m) => m.userId === viewerId) || null : null;
        return {
          ...g,
          membersCount: gMembers.filter((m) => m.status === 'active').length,
          pendingCount: gMembers.filter((m) => m.status === 'pending').length,
          myMembership: myMem,
        };
      }),
    });
  } catch (err) {
    console.error('GET /api/community/groups failed:', err);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

router.post('/groups', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { name, description, privacy } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Group name required' });

    const [created] = await db
      .insert(groups)
      .values({
        creatorId: userId,
        name: String(name).trim().slice(0, 100),
        description: String(description || '').slice(0, 500),
        privacy: privacy === 'private' ? 'private' : 'public',
        coverUrl: '/src/assets/images/tiger_default_cover_1795106934343.jpg',
      })
      .returning();

    await db.insert(groupMembers).values({
      groupId: created.id,
      userId,
      role: 'admin',
      status: 'active',
    });

    // Create linked group chat
    const [chat] = await db
      .insert(chats)
      .values({ chatType: 'group', name: created.name, groupId: created.id, createdBy: userId })
      .returning();
    await db.insert(chatMembers).values({ chatId: chat.id, userId, role: 'admin' });

    res.status(201).json({ group: created });
  } catch (err) {
    console.error('POST /api/community/groups failed:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

router.post('/groups/:id/join', requireAuth, async (req: AuthRequest, res) => {
  try {
    const groupId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const [existing] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);

    if (existing) {
      await db.delete(groupMembers).where(eq(groupMembers.id, existing.id));
      return res.json({ status: 'left' });
    }

    const status = group.privacy === 'private' ? 'pending' : 'active';
    await db.insert(groupMembers).values({ groupId, userId, role: 'member', status });

    if (status === 'active') {
      const [groupChat] = await db.select().from(chats).where(eq(chats.groupId, groupId)).limit(1);
      if (groupChat) {
        await db.insert(chatMembers).values({ chatId: groupChat.id, userId, role: 'member' }).onConflictDoNothing();
      }
    } else {
      await createNotification({
        userId: group.creatorId,
        actorId: userId,
        type: 'group',
        title: 'طلب انضمام للمجموعة',
        body: `${req.dbUser!.displayName} طلب الانضمام إلى ${group.name}`,
        entityType: 'group',
        entityId: groupId,
      });
    }

    res.json({ status });
  } catch (err) {
    console.error('POST /api/community/groups/:id/join failed:', err);
    res.status(500).json({ error: 'Failed to update group membership' });
  }
});

router.get('/groups/:id/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    const groupId = Number(req.params.id);
    const rows = await db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId));
    const userIds = rows.map((r) => r.userId);
    const membersUsers = userIds.length ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
    const uMap = new Map(membersUsers.map((u) => [u.id, u]));

    res.json({
      members: rows.map((r) => ({
        ...r,
        user: uMap.get(r.userId)
          ? {
              id: uMap.get(r.userId)!.id,
              displayName: uMap.get(r.userId)!.displayName,
              username: uMap.get(r.userId)!.username,
              avatarUrl: uMap.get(r.userId)!.avatarUrl,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error('GET /api/community/groups/:id/members failed:', err);
    res.status(500).json({ error: 'Failed to load group members' });
  }
});

router.patch('/groups/:id/members/:userId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const groupId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    const [myMem] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.dbUser!.id)))
      .limit(1);
    if (!myMem || (myMem.role !== 'admin' && myMem.role !== 'moderator')) {
      return res.status(403).json({ error: 'Moderator or admin privileges required' });
    }

    const { role, status } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (role === 'admin' || role === 'moderator' || role === 'member') updates.role = role;
    if (status === 'active' || status === 'pending') updates.status = status;

    await db
      .update(groupMembers)
      .set(updates)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

    if (status === 'active') {
      const [groupChat] = await db.select().from(chats).where(eq(chats.groupId, groupId)).limit(1);
      if (groupChat) {
        await db
          .insert(chatMembers)
          .values({ chatId: groupChat.id, userId: targetUserId, role: 'member' })
          .onConflictDoNothing();
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/community/groups/:id/members/:userId failed:', err);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// --- PAGES ---
router.get('/pages', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const allPages = await db.select().from(pages).orderBy(desc(pages.createdAt));
    const viewerId = req.dbUser?.id;
    const myFollows = viewerId
      ? await db.select().from(pageFollowers).where(eq(pageFollowers.userId, viewerId))
      : [];
    const followMap = new Map(myFollows.map((f) => [f.pageId, f.role]));

    res.json({
      pages: allPages.map((p) => ({
        ...p,
        isFollowing: followMap.has(p.id),
        myRole: p.ownerId === viewerId ? 'owner' : followMap.get(p.id) || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/community/pages failed:', err);
    res.status(500).json({ error: 'Failed to load pages' });
  }
});

router.post('/pages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, category, description, isBusiness } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Page name required' });

    const [created] = await db
      .insert(pages)
      .values({
        ownerId: req.dbUser!.id,
        name: String(name).trim().slice(0, 100),
        category: String(category || 'Creator').slice(0, 60),
        description: String(description || '').slice(0, 500),
        isBusiness: Boolean(isBusiness),
        coverUrl: '/src/assets/images/tiger_default_cover_1795106934343.jpg',
        followersCount: 1,
      })
      .returning();

    await db.insert(pageFollowers).values({
      pageId: created.id,
      userId: req.dbUser!.id,
      role: 'admin',
    });

    res.status(201).json({ page: created });
  } catch (err) {
    console.error('POST /api/community/pages failed:', err);
    res.status(500).json({ error: 'Failed to create page' });
  }
});

router.post('/pages/:id/follow', requireAuth, async (req: AuthRequest, res) => {
  try {
    const pageId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [existing] = await db
      .select()
      .from(pageFollowers)
      .where(and(eq(pageFollowers.pageId, pageId), eq(pageFollowers.userId, userId)))
      .limit(1);

    if (existing) {
      await db.delete(pageFollowers).where(eq(pageFollowers.id, existing.id));
      await db
        .update(pages)
        .set({ followersCount: sql`GREATEST(0, ${pages.followersCount} - 1)` })
        .where(eq(pages.id, pageId));
      return res.json({ following: false });
    }

    await db.insert(pageFollowers).values({ pageId, userId, role: 'follower' });
    await db
      .update(pages)
      .set({ followersCount: sql`${pages.followersCount} + 1` })
      .where(eq(pages.id, pageId));

    res.json({ following: true });
  } catch (err) {
    console.error('POST /api/community/pages/:id/follow failed:', err);
    res.status(500).json({ error: 'Failed to toggle page follow' });
  }
});

export default router;
