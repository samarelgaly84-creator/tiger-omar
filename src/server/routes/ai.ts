import { Router } from 'express';
import { eq, desc, asc, inArray, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  aiConversations,
  aiMessages,
  cloudFiles,
  fileShares,
  users,
} from '../../db/schema.ts';
import { requireAuth, AuthRequest } from '../../middleware/auth.ts';
import {
  generateTigerAssistantReply,
  generateTigerAssistantReplyStream,
  analyzeDriveFiles,
  GeminiServiceError,
  hasValidGeminiKey,
} from '../gemini.ts';

const router = Router();

router.get('/status', requireAuth, (_req: AuthRequest, res) => {
  res.json({
    configured: hasValidGeminiKey(),
    model: 'gemini-4-hydrogen',
  });
});

router.get('/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, req.dbUser!.id))
      .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id));
    res.json({ conversations: list });
  } catch (err) {
    console.error('GET /api/ai/conversations failed:', err);
    res.status(500).json({ error: 'Failed to load AI conversations' });
  }
});

router.post('/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { title, mode } = req.body || {};
    const allowedModes = new Set(['assistant', 'drive_ai']);
    const [created] = await db
      .insert(aiConversations)
      .values({
        userId: req.dbUser!.id,
        title: String(title || 'محادثة TIGER AI').slice(0, 120),
        mode: allowedModes.has(mode) ? mode : 'assistant',
      })
      .returning();
    res.status(201).json({ conversation: created });
  } catch (err) {
    console.error('POST /api/ai/conversations failed:', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

router.delete('/conversations/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1);
    if (!conv || conv.userId !== req.dbUser!.id) return res.status(404).json({ error: 'Conversation not found' });
    await db.delete(aiConversations).where(eq(aiConversations.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/ai/conversations/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

router.get('/conversations/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1);
    if (!conv || conv.userId !== req.dbUser!.id) return res.status(404).json({ error: 'Conversation not found' });
    const msgs = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, id))
      .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id));
    res.json({ conversation: conv, messages: msgs });
  } catch (err) {
    console.error('GET /api/ai/conversations/:id/messages failed:', err);
    res.status(500).json({ error: 'Failed to load AI messages' });
  }
});

async function checkAiCreditAvailable(userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error('User not found');
  return {
    allowed: u.aiCreditsUsed < u.aiCreditsLimit,
    used: u.aiCreditsUsed,
    limit: u.aiCreditsLimit,
  };
}

async function consumeAiCredit(userId: number) {
  const [updated] = await db
    .update(users)
    .set({ aiCreditsUsed: sql`${users.aiCreditsUsed} + 1` })
    .where(eq(users.id, userId))
    .returning({ used: users.aiCreditsUsed, limit: users.aiCreditsLimit });
  return {
    allowed: true,
    used: updated?.used ?? 0,
    limit: updated?.limit ?? 30,
  };
}

function sendAiError(res: any, err: unknown, fallbackMessage: string) {
  if (err instanceof GeminiServiceError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
    });
  }
  const anyErr = err as any;
  const status = Number(anyErr?.status || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    error: anyErr?.message || fallbackMessage,
    code: anyErr?.code || 'AI_UPSTREAM_ERROR',
  });
}

async function prepareChatContext(userId: number, conversationId: unknown, prompt: unknown) {
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt) {
    throw new GeminiServiceError('Prompt is required', 400, 'EMPTY_RESPONSE');
  }

  const creditCheck = await checkAiCreditAvailable(userId);
  if (!creditCheck.allowed) {
    return {
      ok: false as const,
      errorStatus: 429 as const,
      errorBody: {
        error: 'Monthly AI credits exhausted for your current plan. Upgrade to TIGER PLUS or PRO.',
        code: 'CREDITS_EXHAUSTED',
      },
    };
  }

  let convId = conversationId ? Number(conversationId) : null;
  let prevMsgs: Array<{ role: string; content: string }> = [];

  if (convId !== null) {
    if (!Number.isFinite(convId)) {
      return { ok: false as const, errorStatus: 400 as const, errorBody: { error: 'Invalid conversation ID' } };
    }
    const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, convId)).limit(1);
    if (!conv || conv.userId !== userId) {
      return { ok: false as const, errorStatus: 403 as const, errorBody: { error: 'Unauthorized conversation' } };
    }
    const recent = await db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, convId))
      .orderBy(desc(aiMessages.id))
      .limit(20);
    prevMsgs = recent.reverse();
  }

  return {
    ok: true as const,
    trimmedPrompt,
    convId,
    history: prevMsgs.map((m) => ({
      role: (m.role === 'model' ? 'model' : 'user') as 'user' | 'model',
      content: m.content,
    })),
  };
}

async function saveAiTurn(params: {
  userId: number;
  convId: number | null;
  trimmedPrompt: string;
  replyText: string;
}) {
  let finalConvId = params.convId;
  if (!finalConvId) {
    const [conv] = await db
      .insert(aiConversations)
      .values({
        userId: params.userId,
        title: params.trimmedPrompt.slice(0, 60),
        mode: 'assistant',
      })
      .returning();
    finalConvId = conv.id;
  }

  const inserted = await db
    .insert(aiMessages)
    .values([
      {
        conversationId: finalConvId,
        role: 'user',
        content: params.trimmedPrompt,
      },
      {
        conversationId: finalConvId,
        role: 'model',
        content: params.replyText,
      },
    ])
    .returning();

  const [userMsg, modelMsg] = inserted;

  const [, credits] = await Promise.all([
    db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, finalConvId)),
    consumeAiCredit(params.userId),
  ]);

  return {
    conversationId: finalConvId,
    userMessage: userMsg,
    message: modelMsg,
    credits,
  };
}

router.post('/chat/stream', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.dbUser!.id;
  const { conversationId, prompt, taskPreset } = req.body || {};
  const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmed) {
    return res.status(400).json({ error: 'Prompt is required', code: 'EMPTY_PROMPT' });
  }

  let headersSent = false;
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const ctx = await prepareChatContext(userId, conversationId, trimmed);
    if (!ctx.ok) {
      return res.status(ctx.errorStatus).json(ctx.errorBody);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    headersSent = true;

    const writeEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    const replyText = await generateTigerAssistantReplyStream({
      history: ctx.history,
      prompt: ctx.trimmedPrompt,
      taskPreset: typeof taskPreset === 'string' ? taskPreset : undefined,
      signal: abortController.signal,
      onChunk: (delta) => {
        writeEvent({ type: 'delta', text: delta });
      },
    });

    if (abortController.signal.aborted) {
      return;
    }

    const saved = await saveAiTurn({
      userId,
      convId: ctx.convId,
      trimmedPrompt: ctx.trimmedPrompt,
      replyText,
    });

    writeEvent({
      type: 'done',
      ...saved,
    });
    res.end();
  } catch (err: any) {
    if (abortController.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('POST /api/ai/chat/stream failed:', err);
    const code = err instanceof GeminiServiceError ? err.code : err?.code || 'AI_UPSTREAM_ERROR';
    const message = err?.message || 'AI request failed';

    if (!headersSent) {
      return sendAiError(res, err, 'AI request failed');
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: message, code })}\n\n`);
      res.end();
    }
  }
});

router.post('/chat', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { conversationId, prompt, taskPreset } = req.body || {};
    const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (!trimmedPrompt) {
      return res.status(400).json({ error: 'Prompt is required', code: 'EMPTY_PROMPT' });
    }

    const ctx = await prepareChatContext(userId, conversationId, trimmedPrompt);
    if (!ctx.ok) {
      return res.status(ctx.errorStatus).json(ctx.errorBody);
    }

    // Execute Gemini request BEFORE inserting messages or consuming credits
    const replyText = await generateTigerAssistantReply({
      history: ctx.history,
      prompt: ctx.trimmedPrompt,
      taskPreset: typeof taskPreset === 'string' ? taskPreset : undefined,
    });

    const saved = await saveAiTurn({
      userId,
      convId: ctx.convId,
      trimmedPrompt: ctx.trimmedPrompt,
      replyText,
    });

    res.json(saved);
  } catch (err: any) {
    console.error('POST /api/ai/chat failed:', err);
    return sendAiError(res, err, 'AI request failed');
  }
});

// TIGER DRIVE AI — Strictly verifies ownership or fileShares access before reading files
router.post('/drive', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { fileIds, folderId, action, question, language } = req.body || {};

    const creditCheck = await checkAiCreditAvailable(userId);
    if (!creditCheck.allowed) {
      return res.status(429).json({ error: 'Monthly AI credits exhausted.', code: 'CREDITS_EXHAUSTED' });
    }

    let targetFiles: Array<typeof cloudFiles.$inferSelect> = [];

    if (folderId) {
      const fid = Number(folderId);
      const folderFiles = await db
        .select()
        .from(cloudFiles)
        .where(and(eq(cloudFiles.folderId, fid), eq(cloudFiles.ownerId, userId), eq(cloudFiles.isTrashed, false)));
      targetFiles = folderFiles;
    } else if (Array.isArray(fileIds) && fileIds.length > 0) {
      const ids = fileIds.map(Number).filter(Boolean);
      const candidates = await db.select().from(cloudFiles).where(inArray(cloudFiles.id, ids));

      // Verify permission for every single requested file
      const shares = await db
        .select()
        .from(fileShares)
        .where(and(inArray(fileShares.fileId, ids), eq(fileShares.sharedWithUserId, userId)));
      const sharedSet = new Set(shares.map((s) => s.fileId));

      for (const f of candidates) {
        if (f.ownerId !== userId && !sharedSet.has(f.id)) {
          return res.status(403).json({
            error: `Access denied: You do not have permission for file "${f.fileName}"`,
          });
        }
      }
      targetFiles = candidates;
    } else if (action === 'smart_search') {
      targetFiles = await db
        .select()
        .from(cloudFiles)
        .where(and(eq(cloudFiles.ownerId, userId), eq(cloudFiles.isTrashed, false)))
        .limit(25);
    }

    if (targetFiles.length === 0) {
      return res.status(400).json({ error: 'No authorized files found to analyze' });
    }

    const analysis = await analyzeDriveFiles({
      files: targetFiles.map((f) => ({
        id: f.id,
        name: f.fileName,
        mimeType: f.mimeType,
        storagePath: f.storagePath,
        extractedText: f.extractedText,
      })),
      action: action || 'summarize',
      question,
      language: language === 'en' ? 'en' : 'ar',
    });

    const [conv] = await db
      .insert(aiConversations)
      .values({
        userId,
        title: `Drive AI: ${targetFiles[0].fileName.slice(0, 32)}`,
        mode: 'drive_ai',
      })
      .returning();

    await db.insert(aiMessages).values([
      {
        conversationId: conv.id,
        role: 'user',
        content: question || `${action}: ${targetFiles.map((f) => f.fileName).join(', ')}`,
        referencedFileIds: targetFiles.map((f) => f.id),
      },
      {
        conversationId: conv.id,
        role: 'model',
        content: analysis.text,
        referencedFileIds: targetFiles.map((f) => f.id),
      },
    ]);

    const credits = await consumeAiCredit(userId);

    res.json({
      conversationId: conv.id,
      result: analysis.text,
      isQuiz: analysis.isQuiz,
      analyzedFiles: targetFiles.map((f) => ({ id: f.id, fileName: f.fileName })),
      credits,
    });
  } catch (err: any) {
    console.error('POST /api/ai/drive failed:', err);
    return sendAiError(res, err, 'Drive AI analysis failed');
  }
});

export default router;
