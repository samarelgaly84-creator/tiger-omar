import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  users,
  profiles,
  userSessions,
  posts,
  cloudFiles,
  notifications,
  friends,
  followers,
} from '../../db/schema.ts';
import { requireAuth, AuthRequest } from '../../middleware/auth.ts';
import { uploadMiddleware } from '../upload.ts';

const router = Router();

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.dbUser!;
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, u.id)).limit(1);
    res.json({ user: u, profile: profile || null });
  } catch (err) {
    console.error('GET /api/auth/me failed:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.patch('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.dbUser!;
    const {
      displayName,
      username,
      bio,
      avatarUrl,
      coverUrl,
      location,
      website,
      workplace,
      education,
      birthdate,
      privacySettings,
      notificationSettings,
      language,
      theme,
    } = req.body || {};

    const userUpdates: Record<string, unknown> = {};
    if (typeof displayName === 'string' && displayName.trim()) {
      userUpdates.displayName = displayName.trim().slice(0, 80);
    }
    if (typeof username === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      userUpdates.username = username.trim().toLowerCase();
    }
    if (typeof bio === 'string') userUpdates.bio = bio.slice(0, 500);
    if (typeof avatarUrl === 'string') userUpdates.avatarUrl = avatarUrl;
    if (typeof coverUrl === 'string') userUpdates.coverUrl = coverUrl;

    let updatedUser = u;
    if (Object.keys(userUpdates).length > 0) {
      const [resUser] = await db
        .update(users)
        .set(userUpdates)
        .where(eq(users.id, u.id))
        .returning();
      updatedUser = resUser;
    }

    const profileUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof location === 'string') profileUpdates.location = location.slice(0, 120);
    if (typeof website === 'string') profileUpdates.website = website.slice(0, 200);
    if (typeof workplace === 'string') profileUpdates.workplace = workplace.slice(0, 120);
    if (typeof education === 'string') profileUpdates.education = education.slice(0, 120);
    if (typeof birthdate === 'string') profileUpdates.birthdate = birthdate.slice(0, 32);
    if (privacySettings && typeof privacySettings === 'object') {
      profileUpdates.privacySettings = privacySettings;
    }
    if (notificationSettings && typeof notificationSettings === 'object') {
      profileUpdates.notificationSettings = notificationSettings;
    }
    if (language === 'ar' || language === 'en') profileUpdates.language = language;
    if (theme === 'dark' || theme === 'light') profileUpdates.theme = theme;

    const [existingProfile] = await db.select().from(profiles).where(eq(profiles.userId, u.id)).limit(1);
    if (existingProfile && profileUpdates.privacySettings && typeof profileUpdates.privacySettings === 'object') {
      profileUpdates.privacySettings = {
        ...existingProfile.privacySettings,
        ...(profileUpdates.privacySettings as Record<string, unknown>),
      };
    }
    let updatedProfile = existingProfile;
    if (existingProfile) {
      const [p] = await db
        .update(profiles)
        .set(profileUpdates)
        .where(eq(profiles.userId, u.id))
        .returning();
      updatedProfile = p;
    } else {
      const [p] = await db
        .insert(profiles)
        .values({ userId: u.id, ...profileUpdates } as any)
        .returning();
      updatedProfile = p;
    }

    res.json({ user: updatedUser, profile: updatedProfile });
  } catch (err: any) {
    console.error('PATCH /api/auth/profile failed:', err);
    if ((err?.cause?.code || err?.code) === '23505') {
      return res.status(409).json({ error: 'Username is already taken' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/avatar', requireAuth, uploadMiddleware.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const kind = req.body?.kind === 'cover' ? 'coverUrl' : 'avatarUrl';
    const url = `/uploads/${req.file.filename}`;
    const [updated] = await db
      .update(users)
      .set({ [kind]: url })
      .where(eq(users.id, req.dbUser!.id))
      .returning();
    res.json({ url, user: updated });
  } catch (err) {
    console.error('POST /api/auth/avatar failed:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.post('/public-key', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { publicKeyJwk } = req.body || {};
    if (!publicKeyJwk || typeof publicKeyJwk !== 'object') {
      return res.status(400).json({ error: 'Invalid JWK public key' });
    }
    await db
      .update(users)
      .set({ publicKeyJwk })
      .where(eq(users.id, req.dbUser!.id));
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/public-key failed:', err);
    res.status(500).json({ error: 'Failed to save encryption key' });
  }
});

router.get('/sessions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, req.dbUser!.id))
      .orderBy(desc(userSessions.lastActiveAt))
      .limit(15);
    res.json({ sessions: list });
  } catch (err) {
    console.error('GET /api/auth/sessions failed:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

router.get('/export', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const userPosts = await db.select().from(posts).where(eq(posts.authorId, userId));
    const userFiles = await db.select().from(cloudFiles).where(eq(cloudFiles.ownerId, userId));
    const userFriends = await db.select().from(friends).where(eq(friends.userId, userId));
    const userFollowers = await db.select().from(followers).where(eq(followers.followingId, userId));
    const userNotifications = await db.select().from(notifications).where(eq(notifications.userId, userId)).limit(100);

    res.setHeader('Content-Disposition', `attachment; filename="tiger-account-export-${userId}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      user: req.dbUser,
      profile,
      posts: userPosts,
      cloudFiles: userFiles,
      friendsCount: userFriends.length,
      followersCount: userFollowers.length,
      recentNotifications: userNotifications,
    });
  } catch (err) {
    console.error('GET /api/auth/export failed:', err);
    res.status(500).json({ error: 'Failed to export account data' });
  }
});

router.delete('/account', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db.delete(users).where(eq(users.id, req.dbUser!.id));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/auth/account failed:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
