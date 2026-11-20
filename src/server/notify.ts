import { db } from '../db/index.ts';
import { notifications } from '../db/schema.ts';
import { broadcastToUser } from './ws.ts';

export async function createNotification(params: {
  userId: number;
  actorId?: number | null;
  type:
    | 'message'
    | 'friend_request'
    | 'reaction'
    | 'comment'
    | 'share'
    | 'mention'
    | 'follow'
    | 'group'
    | 'page'
    | 'file_share'
    | 'live';
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
}) {
  if (params.actorId && params.actorId === params.userId) return null;

  try {
    const [inserted] = await db
      .insert(notifications)
      .values({
        userId: params.userId,
        actorId: params.actorId ?? null,
        type: params.type,
        title: params.title,
        body: params.body,
        entityType: params.entityType,
        entityId: params.entityId,
      })
      .returning();

    broadcastToUser(params.userId, 'notification:new', inserted);
    return inserted;
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
}
