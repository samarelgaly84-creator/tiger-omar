import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { syncFirebaseUser, verifyFirebaseTokenWithSkewRetry } from '../middleware/auth.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

interface AuthedSocket extends WebSocket {
  userId?: number;
  displayName?: string;
  activeLiveRoomId?: number;
  isAlive?: boolean;
}

// Map userId -> Set<AuthedSocket>
const userSockets = new Map<number, Set<AuthedSocket>>();
// Map liveStreamId -> Set<AuthedSocket>
const liveRooms = new Map<number, Set<AuthedSocket>>();

export function broadcastToUser(userId: number, event: string, payload: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const data = JSON.stringify({ event, payload });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function broadcastToUsers(userIds: number[], event: string, payload: unknown) {
  for (const uid of userIds) {
    broadcastToUser(uid, event, payload);
  }
}

export function broadcastToLiveRoom(streamId: number, event: string, payload: unknown, excludeSocket?: AuthedSocket) {
  const room = liveRooms.get(streamId);
  if (!room) return;
  const data = JSON.stringify({ event, payload });
  for (const ws of room) {
    if (ws !== excludeSocket && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function getOnlineUserIds(): number[] {
  return Array.from(userSockets.keys());
}

export function setupWebSocketServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws as AuthedSocket;
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', async (ws: AuthedSocket, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Authenticate via query token if provided
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (token) {
        const decoded = await verifyFirebaseTokenWithSkewRetry(token);
        const dbUser = await syncFirebaseUser(decoded);
        if (!dbUser.isBanned) {
          attachSocketToUser(ws, dbUser.id, dbUser.displayName);
        }
      }
    } catch {
      // Client can still authenticate via { event: 'auth', token }
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { event: string; payload?: any };
        if (!msg || !msg.event) return;

        if (msg.event === 'auth' && msg.payload?.token) {
          try {
            const decoded = await verifyFirebaseTokenWithSkewRetry(msg.payload.token);
            const dbUser = await syncFirebaseUser(decoded);
            if (!dbUser.isBanned) {
              attachSocketToUser(ws, dbUser.id, dbUser.displayName);
              ws.send(JSON.stringify({ event: 'auth:ok', payload: { userId: dbUser.id } }));
            }
          } catch {
            ws.send(JSON.stringify({ event: 'auth:error', payload: { error: 'Invalid token' } }));
          }
          return;
        }

        if (!ws.userId) return;

        switch (msg.event) {
          case 'chat:typing': {
            const { chatId, targetUserIds, isTyping } = msg.payload || {};
            if (Array.isArray(targetUserIds)) {
              broadcastToUsers(
                targetUserIds.filter((id: number) => id !== ws.userId),
                'chat:typing',
                { chatId, userId: ws.userId, displayName: ws.displayName, isTyping }
              );
            }
            break;
          }

          // P2P WebRTC Call Signaling
          case 'call:invite':
          case 'call:accept':
          case 'call:reject':
          case 'call:end':
          case 'webrtc:offer':
          case 'webrtc:answer':
          case 'webrtc:ice': {
            const { targetUserId } = msg.payload || {};
            if (typeof targetUserId === 'number') {
              broadcastToUser(targetUserId, msg.event, {
                ...msg.payload,
                fromUserId: ws.userId,
                fromDisplayName: ws.displayName,
              });
            }
            break;
          }

          // Live Streaming Room Events & WebRTC Broadcast Signaling
          case 'live:join': {
            const streamId = Number(msg.payload?.streamId);
            if (!Number.isNaN(streamId)) {
              if (!liveRooms.has(streamId)) liveRooms.set(streamId, new Set());
              liveRooms.get(streamId)!.add(ws);
              ws.activeLiveRoomId = streamId;
              const viewerCount = liveRooms.get(streamId)!.size;
              broadcastToLiveRoom(streamId, 'live:viewers', { streamId, viewerCount, joinedUserId: ws.userId });
            }
            break;
          }
          case 'live:leave': {
            const streamId = Number(msg.payload?.streamId || ws.activeLiveRoomId);
            if (!Number.isNaN(streamId)) {
              liveRooms.get(streamId)?.delete(ws);
              ws.activeLiveRoomId = undefined;
              const viewerCount = liveRooms.get(streamId)?.size || 0;
              broadcastToLiveRoom(streamId, 'live:viewers', { streamId, viewerCount });
            }
            break;
          }
          case 'live:comment': {
            const { streamId, text } = msg.payload || {};
            if (streamId && text) {
              broadcastToLiveRoom(Number(streamId), 'live:comment', {
                id: Date.now(),
                streamId: Number(streamId),
                userId: ws.userId,
                displayName: ws.displayName,
                text: String(text).slice(0, 500),
                createdAt: new Date().toISOString(),
              });
            }
            break;
          }
          case 'live:reaction': {
            const { streamId, reaction } = msg.payload || {};
            if (streamId && reaction) {
              broadcastToLiveRoom(Number(streamId), 'live:reaction', {
                streamId: Number(streamId),
                userId: ws.userId,
                reaction: String(reaction).slice(0, 16),
              });
            }
            break;
          }
          case 'live:guest-invite':
          case 'live:guest-accept':
          case 'live:webrtc-offer':
          case 'live:webrtc-answer':
          case 'live:webrtc-ice': {
            const { targetUserId, streamId } = msg.payload || {};
            if (typeof targetUserId === 'number') {
              broadcastToUser(targetUserId, msg.event, {
                ...msg.payload,
                fromUserId: ws.userId,
                fromDisplayName: ws.displayName,
              });
            } else if (streamId) {
              broadcastToLiveRoom(Number(streamId), msg.event, {
                ...msg.payload,
                fromUserId: ws.userId,
                fromDisplayName: ws.displayName,
              }, ws);
            }
            break;
          }
        }
      } catch (err) {
        console.error('WS message handler error:', err);
      }
    });

    ws.on('close', () => {
      if (ws.activeLiveRoomId) {
        const room = liveRooms.get(ws.activeLiveRoomId);
        room?.delete(ws);
        broadcastToLiveRoom(ws.activeLiveRoomId, 'live:viewers', {
          streamId: ws.activeLiveRoomId,
          viewerCount: room?.size || 0,
        });
      }
      if (ws.userId) {
        const set = userSockets.get(ws.userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            userSockets.delete(ws.userId);
            void db
              .update(users)
              .set({ isOnline: false, lastSeenAt: new Date() })
              .where(eq(users.id, ws.userId))
              .catch(() => {});
          }
        }
      }
    });
  });

  return wss;
}

function attachSocketToUser(ws: AuthedSocket, userId: number, displayName: string) {
  ws.userId = userId;
  ws.displayName = displayName;
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId)!.add(ws);
}
