import { Router } from 'express';
import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  chatMembers,
  chats,
  friends,
  liveLocationShares,
  messages,
  posts,
  profiles,
  savedPlaces,
  users,
} from '../../db/schema.ts';
import { AuthRequest, requireAuth } from '../../middleware/auth.ts';
import { broadcastToUsers } from '../ws.ts';
import { createNotification } from '../notify.ts';

const router = Router();

const ALLOWED_DURATIONS = new Set([15, 60, 480]);

function isValidCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return null;
  return { lat: nLat, lng: nLng };
}

/**
 * Scrubs coordinates from any expired live shares so live coordinates are never kept permanently.
 */
async function purgeExpiredLiveLocations() {
  const now = new Date();
  await db
    .update(liveLocationShares)
    .set({
      isActive: false,
      lat: null,
      lng: null,
      accuracy: null,
      stoppedAt: now,
      updatedAt: now,
    })
    .where(and(eq(liveLocationShares.isActive, true), lte(liveLocationShares.expiresAt, now)));
}

async function getFriendIdSet(userId: number): Promise<Set<number>> {
  const rows = await db.select({ friendId: friends.friendId }).from(friends).where(eq(friends.userId, userId));
  return new Set(rows.map((r) => r.friendId));
}

async function getAuthorizedRecipientsForShare(
  share: typeof liveLocationShares.$inferSelect
): Promise<number[]> {
  if (share.shareScope === 'chat' && share.chatId) {
    const members = await db
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(eq(chatMembers.chatId, share.chatId));
    return members.map((m) => m.userId).filter((id) => id !== share.userId);
  }

  if (share.shareScope === 'friends') {
    const friendSet = await getFriendIdSet(share.userId);
    return Array.from(friendSet);
  }

  return [];
}

async function reverseGeocodeNominatim(lat: number, lng: number, lang: string) {
  const fallbackLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lng)}&zoom=16&addressdetails=1&accept-language=${
      lang === 'en' ? 'en' : 'ar,en'
    }`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TIGER-Platform/1.0 (https://tiger-platform.local)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5500),
    });
    if (!res.ok) {
      throw new Error(`Nominatim HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    const addr = data?.address || {};
    const city =
      addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.county || '';
    const region = addr.state || addr.region || addr.province || '';
    const country = addr.country || '';
    const shortParts = [city, region, country].filter(Boolean);
    const label = shortParts.length > 0 ? shortParts.join('، ') : data?.display_name || fallbackLabel;
    return {
      lat,
      lng,
      city,
      region,
      country,
      displayName: data?.display_name || label,
      label,
      fallback: false,
    };
  } catch {
    return {
      lat,
      lng,
      city: '',
      region: '',
      country: '',
      displayName: fallbackLabel,
      label: fallbackLabel,
      fallback: true,
    };
  }
}

router.get('/reverse', requireAuth, async (req: AuthRequest, res) => {
  const coords = isValidCoords(req.query.lat, req.query.lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid lat and lng query parameters are required' });
  }
  const lang = String(req.query.lang || 'ar');
  const info = await reverseGeocodeNominatim(coords.lat, coords.lng, lang);
  res.json(info);
});

router.get('/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ places: [] });
    const lang = String(req.query.lang || 'ar');

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      q
    )}&limit=8&addressdetails=1&accept-language=${lang === 'en' ? 'en' : 'ar,en'}`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'TIGER-Platform/1.0 (https://tiger-platform.local)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      return res.status(502).json({ error: 'Location search service unavailable' });
    }

    const raw = (await resp.json()) as any[];
    const places = (Array.isArray(raw) ? raw : [])
      .map((item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const addr = item.address || {};
        const city = addr.city || addr.town || addr.village || addr.state || '';
        const country = addr.country || '';
        return {
          name: item.name || item.display_name?.split(',')[0] || q,
          displayName: item.display_name || '',
          lat,
          lng,
          city,
          country,
          category: item.type || item.class || 'place',
        };
      })
      .filter(Boolean);

    res.json({ places });
  } catch (err) {
    console.error('GET /api/location/search failed:', err);
    res.status(502).json({ error: 'Failed to search places on OpenStreetMap' });
  }
});

// Active Live Location Shares (caller's own + strictly authorized peer shares)
router.get('/live', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    await purgeExpiredLiveLocations();

    const myShares = await db
      .select()
      .from(liveLocationShares)
      .where(and(eq(liveLocationShares.userId, userId), eq(liveLocationShares.isActive, true)))
      .orderBy(desc(liveLocationShares.createdAt));

    const [friendSet, myChatRows] = await Promise.all([
      getFriendIdSet(userId),
      db.select({ chatId: chatMembers.chatId }).from(chatMembers).where(eq(chatMembers.userId, userId)),
    ]);
    const myChatIds = new Set(myChatRows.map((c) => c.chatId));

    const candidateShares = await db
      .select()
      .from(liveLocationShares)
      .where(and(eq(liveLocationShares.isActive, true), ne(liveLocationShares.userId, userId)))
      .orderBy(desc(liveLocationShares.updatedAt));

    const authorizedShares = candidateShares.filter((s) => {
      if (s.lat === null || s.lng === null) return false;
      if (s.shareScope === 'chat' && s.chatId && myChatIds.has(s.chatId)) return true;
      if (s.shareScope === 'friends' && friendSet.has(s.userId)) return true;
      return false;
    });

    const sharerIds = Array.from(new Set(authorizedShares.map((s) => s.userId)));
    const sharers =
      sharerIds.length > 0 ? await db.select().from(users).where(inArray(users.id, sharerIds)) : [];
    const sharerMap = new Map(
      sharers.map((u) => [
        u.id,
        { id: u.id, displayName: u.displayName, username: u.username, avatarUrl: u.avatarUrl },
      ])
    );

    res.json({
      myShares,
      sharedWithMe: authorizedShares.map((s) => ({
        ...s,
        user: sharerMap.get(s.userId) || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/location/live failed:', err);
    res.status(500).json({ error: 'Failed to load live locations' });
  }
});

// Start Live Location Sharing (15m, 1h, 8h)
router.post('/live/start', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    await purgeExpiredLiveLocations();

    const { lat, lng, accuracy, label, durationMinutes, scope, chatId, sendChatMessage } = req.body || {};
    const coords = isValidCoords(lat, lng);
    if (!coords) {
      return res.status(400).json({ error: 'Valid coordinates (lat, lng) are required' });
    }

    const duration = Number(durationMinutes || 15);
    if (!ALLOWED_DURATIONS.has(duration)) {
      return res.status(400).json({ error: 'Allowed durations are 15, 60, or 480 minutes' });
    }

    const shareScope: 'chat' | 'friends' = scope === 'friends' ? 'friends' : 'chat';
    const parsedChatId = chatId ? Number(chatId) : null;

    if (shareScope === 'chat') {
      if (!parsedChatId || !Number.isFinite(parsedChatId)) {
        return res.status(400).json({ error: 'chatId is required for chat live location sharing' });
      }
      const [member] = await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, parsedChatId), eq(chatMembers.userId, userId)))
        .limit(1);
      if (!member) {
        return res.status(403).json({ error: 'Not a member of this chat' });
      }
    }

    const resolvedLabel =
      typeof label === 'string' && label.trim()
        ? label.trim().slice(0, 180)
        : `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;

    const expiresAt = new Date(Date.now() + duration * 60_000);

    const [createdShare] = await db
      .insert(liveLocationShares)
      .values({
        userId,
        chatId: shareScope === 'chat' ? parsedChatId : null,
        shareScope,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
        label: resolvedLabel,
        durationMinutes: duration,
        expiresAt,
        isActive: true,
      })
      .returning();

    const recipients = await getAuthorizedRecipientsForShare(createdShare);
    let createdMessage: any = null;

    if (shareScope === 'chat' && parsedChatId && sendChatMessage !== false) {
      const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, parsedChatId));
      const [msgRow] = await db
        .insert(messages)
        .values({
          chatId: parsedChatId,
          senderId: userId,
          content: resolvedLabel,
          messageType: 'location',
          locationData: {
            lat: coords.lat,
            lng: coords.lng,
            label: resolvedLabel,
            liveShareId: createdShare.id,
            isLive: true,
            expiresAt: expiresAt.toISOString(),
            durationMinutes: duration,
            stopped: false,
          },
          readBy: [userId],
          deliveredTo: members.map((m) => m.userId),
        })
        .returning();

      await db.update(chats).set({ lastMessageAt: new Date() }).where(eq(chats.id, parsedChatId));

      createdMessage = {
        ...msgRow,
        sender: {
          id: req.dbUser!.id,
          displayName: req.dbUser!.displayName,
          username: req.dbUser!.username,
          avatarUrl: req.dbUser!.avatarUrl,
        },
        attachments: [],
      };

      broadcastToUsers(
        members.map((m) => m.userId),
        'chat:message',
        createdMessage
      );

      for (const rid of recipients) {
        await createNotification({
          userId: rid,
          actorId: userId,
          type: 'message',
          title: 'مشاركة موقع مباشر',
          body: `${req.dbUser!.displayName} بدأ مشاركة موقعه المباشر`,
          entityType: 'chat',
          entityId: parsedChatId,
        });
      }
    }

    if (recipients.length > 0) {
      broadcastToUsers(recipients, 'location:live-update', {
        ...createdShare,
        user: {
          id: req.dbUser!.id,
          displayName: req.dbUser!.displayName,
          username: req.dbUser!.username,
          avatarUrl: req.dbUser!.avatarUrl,
        },
      });
    }

    res.status(201).json({ share: createdShare, message: createdMessage });
  } catch (err) {
    console.error('POST /api/location/live/start failed:', err);
    res.status(500).json({ error: 'Failed to start live location share' });
  }
});

// Update Live Coordinates (while active & not expired)
router.patch('/live/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shareId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const coords = isValidCoords(req.body?.lat, req.body?.lng);
    if (!coords) return res.status(400).json({ error: 'Valid lat/lng required' });

    const [share] = await db
      .select()
      .from(liveLocationShares)
      .where(eq(liveLocationShares.id, shareId))
      .limit(1);

    if (!share || share.userId !== userId) {
      return res.status(404).json({ error: 'Live location share not found' });
    }
    if (!share.isActive || share.expiresAt <= new Date()) {
      await purgeExpiredLiveLocations();
      return res.status(410).json({ error: 'Live location share has expired or stopped' });
    }

    const updatedLabel =
      typeof req.body?.label === 'string' && req.body.label.trim()
        ? req.body.label.trim().slice(0, 180)
        : share.label;

    const [updated] = await db
      .update(liveLocationShares)
      .set({
        lat: coords.lat,
        lng: coords.lng,
        accuracy: Number.isFinite(Number(req.body?.accuracy)) ? Number(req.body.accuracy) : share.accuracy,
        label: updatedLabel,
        updatedAt: new Date(),
      })
      .where(eq(liveLocationShares.id, shareId))
      .returning();

    const recipients = await getAuthorizedRecipientsForShare(updated);
    if (recipients.length > 0) {
      broadcastToUsers(recipients, 'location:live-update', {
        ...updated,
        user: {
          id: req.dbUser!.id,
          displayName: req.dbUser!.displayName,
          username: req.dbUser!.username,
          avatarUrl: req.dbUser!.avatarUrl,
        },
      });
    }

    res.json({ share: updated });
  } catch (err) {
    console.error('PATCH /api/location/live/:id failed:', err);
    res.status(500).json({ error: 'Failed to update live location' });
  }
});

async function stopSingleShare(shareId: number, userId: number) {
  const [share] = await db
    .select()
    .from(liveLocationShares)
    .where(eq(liveLocationShares.id, shareId))
    .limit(1);

  if (!share || share.userId !== userId) {
    return null;
  }

  const now = new Date();
  const [stopped] = await db
    .update(liveLocationShares)
    .set({
      isActive: false,
      lat: null,
      lng: null,
      accuracy: null,
      stoppedAt: now,
      updatedAt: now,
    })
    .where(eq(liveLocationShares.id, shareId))
    .returning();

  // If this share was posted inside a chat message, mark that message's live status as stopped
  if (share.chatId) {
    const chatMsgs = await db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, share.chatId), eq(messages.senderId, userId)));
    for (const m of chatMsgs) {
      if (m.locationData?.liveShareId === shareId) {
        const nextLoc = {
          ...m.locationData,
          isLive: false,
          stopped: true,
        };
        const [updatedMsg] = await db
          .update(messages)
          .set({ locationData: nextLoc, updatedAt: now })
          .where(eq(messages.id, m.id))
          .returning();
        const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, share.chatId));
        broadcastToUsers(
          members.map((mem) => mem.userId),
          'chat:edit',
          updatedMsg
        );
      }
    }
  }

  const recipients = await getAuthorizedRecipientsForShare(share);
  if (recipients.length > 0) {
    broadcastToUsers(recipients, 'location:live-stopped', {
      id: share.id,
      userId,
      chatId: share.chatId,
    });
  }

  return stopped;
}

router.post('/live/:id/stop', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shareId = Number(req.params.id);
    const stopped = await stopSingleShare(shareId, req.dbUser!.id);
    if (!stopped) return res.status(404).json({ error: 'Live location share not found' });
    res.json({ ok: true, share: stopped });
  } catch (err) {
    console.error('POST /api/location/live/:id/stop failed:', err);
    res.status(500).json({ error: 'Failed to stop live location sharing' });
  }
});

router.delete('/live/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shareId = Number(req.params.id);
    const stopped = await stopSingleShare(shareId, req.dbUser!.id);
    if (!stopped) return res.status(404).json({ error: 'Live location share not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/location/live/:id failed:', err);
    res.status(500).json({ error: 'Failed to stop live location sharing' });
  }
});

router.post('/live/stop-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const active = await db
      .select()
      .from(liveLocationShares)
      .where(and(eq(liveLocationShares.userId, userId), eq(liveLocationShares.isActive, true)));

    for (const s of active) {
      await stopSingleShare(s.id, userId);
    }

    res.json({ ok: true, stoppedCount: active.length });
  } catch (err) {
    console.error('POST /api/location/live/stop-all failed:', err);
    res.status(500).json({ error: 'Failed to stop active location shares' });
  }
});

// Saved & Shared Places (TIGER MAP Markers)
router.get('/places', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const friendSet = await getFriendIdSet(userId);

    const allRows = await db.select().from(savedPlaces).orderBy(desc(savedPlaces.createdAt));

    const myPlaces = allRows.filter((p) => p.userId === userId);
    const friendPlaces = allRows.filter((p) => {
      if (p.userId === userId) return false;
      const sharedDirectly = Array.isArray(p.sharedWithUserIds) && p.sharedWithUserIds.includes(userId);
      const sharedWithFriends = p.visibility === 'friends' && friendSet.has(p.userId);
      return sharedDirectly || sharedWithFriends;
    });

    const ownerIds = Array.from(new Set(friendPlaces.map((p) => p.userId)));
    const owners =
      ownerIds.length > 0 ? await db.select().from(users).where(inArray(users.id, ownerIds)) : [];
    const ownerMap = new Map(
      owners.map((u) => [
        u.id,
        { id: u.id, displayName: u.displayName, username: u.username, avatarUrl: u.avatarUrl },
      ])
    );

    res.json({
      myPlaces,
      friendPlaces: friendPlaces.map((p) => ({
        ...p,
        owner: ownerMap.get(p.userId) || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/location/places failed:', err);
    res.status(500).json({ error: 'Failed to load saved places' });
  }
});

router.post('/places', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { title, description, category, lat, lng, address, visibility, sharedWithUserIds } = req.body || {};

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    if (!cleanTitle) return res.status(400).json({ error: 'Place title is required' });

    const coords = isValidCoords(lat, lng);
    if (!coords) return res.status(400).json({ error: 'Valid coordinates (lat, lng) are required' });

    const safeVisibility: 'private' | 'friends' = visibility === 'friends' ? 'friends' : 'private';
    const friendSet = await getFriendIdSet(userId);
    const validSharedIds = Array.isArray(sharedWithUserIds)
      ? sharedWithUserIds.map(Number).filter((id) => Number.isFinite(id) && friendSet.has(id))
      : [];

    const [created] = await db
      .insert(savedPlaces)
      .values({
        userId,
        title: cleanTitle.slice(0, 120),
        description: typeof description === 'string' ? description.trim().slice(0, 400) : '',
        category: typeof category === 'string' && category.trim() ? category.trim().slice(0, 40) : 'place',
        lat: coords.lat,
        lng: coords.lng,
        address: typeof address === 'string' ? address.trim().slice(0, 220) : '',
        visibility: safeVisibility,
        sharedWithUserIds: validSharedIds,
      })
      .returning();

    res.status(201).json({ place: created });
  } catch (err) {
    console.error('POST /api/location/places failed:', err);
    res.status(500).json({ error: 'Failed to save place' });
  }
});

router.patch('/places/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const placeId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [existing] = await db.select().from(savedPlaces).where(eq(savedPlaces.id, placeId)).limit(1);
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Place not found' });
    }

    const { title, description, visibility, sharedWithUserIds } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (typeof title === 'string' && title.trim()) updates.title = title.trim().slice(0, 120);
    if (typeof description === 'string') updates.description = description.trim().slice(0, 400);
    if (visibility === 'private' || visibility === 'friends') updates.visibility = visibility;
    if (Array.isArray(sharedWithUserIds)) {
      const friendSet = await getFriendIdSet(userId);
      updates.sharedWithUserIds = sharedWithUserIds
        .map(Number)
        .filter((id) => Number.isFinite(id) && friendSet.has(id));
    }

    const [updated] = await db.update(savedPlaces).set(updates).where(eq(savedPlaces.id, placeId)).returning();
    res.json({ place: updated });
  } catch (err) {
    console.error('PATCH /api/location/places/:id failed:', err);
    res.status(500).json({ error: 'Failed to update place' });
  }
});

router.delete('/places/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const placeId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const [existing] = await db.select().from(savedPlaces).where(eq(savedPlaces.id, placeId)).limit(1);
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Place not found' });
    }
    await db.delete(savedPlaces).where(eq(savedPlaces.id, placeId));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/location/places/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete place' });
  }
});

// Privacy Action: Delete ALL user location data and disable live sharing
router.delete('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;

    // 1. Stop & notify recipients of any active live shares
    const active = await db
      .select()
      .from(liveLocationShares)
      .where(and(eq(liveLocationShares.userId, userId), eq(liveLocationShares.isActive, true)));
    for (const s of active) {
      await stopSingleShare(s.id, userId);
    }

    // 2. Delete all live location shares and saved places
    await Promise.all([
      db.delete(liveLocationShares).where(eq(liveLocationShares.userId, userId)),
      db.delete(savedPlaces).where(eq(savedPlaces.userId, userId)),
      db
        .update(posts)
        .set({ location: null, locationData: null })
        .where(eq(posts.authorId, userId)),
      db
        .update(messages)
        .set({ locationData: null })
        .where(and(eq(messages.senderId, userId), eq(messages.messageType, 'location'))),
    ]);

    // 3. Clear profile location and turn off location privacy toggles
    const [existingProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (existingProfile) {
      await db
        .update(profiles)
        .set({
          location: '',
          privacySettings: {
            ...existingProfile.privacySettings,
            allowLocationServices: false,
            shareLiveWithFriends: false,
          },
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, userId));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/location/me failed:', err);
    res.status(500).json({ error: 'Failed to delete location data' });
  }
});

export default router;
