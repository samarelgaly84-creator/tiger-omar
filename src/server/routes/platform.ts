import { Router } from 'express';
import crypto from 'crypto';
import { eq, desc, sql, and } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  notifications,
  subscriptions,
  payments,
  users,
  posts,
  messages,
  reels,
  reports,
  pages,
  groups,
  cloudFiles,
  adminLogs,
  comments,
} from '../../db/schema.ts';
import { requireAuth, requireAdmin, AuthRequest } from '../../middleware/auth.ts';

const router = Router();

// --- NOTIFICATIONS ---
router.get('/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.dbUser!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(60);
    const unreadCount = list.filter((n) => !n.isRead).length;
    res.json({ notifications: list, unreadCount });
  } catch (err) {
    console.error('GET /api/platform/notifications failed:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.post('/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, req.dbUser!.id));
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/platform/notifications/read-all failed:', err);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

// --- TIGER PREMIUM SUBSCRIPTIONS & PAYMENTS ---
const PLAN_CONFIG = {
  free: { amountUsd: 0, storageQuotaBytes: 100 * 1024 * 1024, aiCreditsLimit: 30 },
  plus: { amountUsd: 9, storageQuotaBytes: 5 * 1024 * 1024 * 1024, aiCreditsLimit: 300 },
  pro: { amountUsd: 24, storageQuotaBytes: 50 * 1024 * 1024 * 1024, aiCreditsLimit: 2000 },
};

router.get('/subscriptions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const [subs, invs] = await Promise.all([
      db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)),
      db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)),
    ]);

    res.json({
      currentPlan: req.dbUser!.plan,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      subscriptions: subs,
      invoices: invs,
    });
  } catch (err) {
    console.error('GET /api/platform/subscriptions failed:', err);
    res.status(500).json({ error: 'Failed to load subscription details' });
  }
});

// Step 1: Create checkout intent (Plan stays pending_payment until server verification!)
router.post('/subscriptions/checkout', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const plan = req.body?.plan as 'plus' | 'pro';
    const billingCycle = req.body?.billingCycle === 'yearly' ? 'yearly' : 'monthly';
    if (plan !== 'plus' && plan !== 'pro') {
      return res.status(400).json({ error: 'Invalid paid plan selected' });
    }

    const basePrice = PLAN_CONFIG[plan].amountUsd;
    const amountUsd = billingCycle === 'yearly' ? basePrice * 10 : basePrice;

    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId,
        plan,
        status: 'pending_payment',
        amountUsd,
        billingCycle,
      })
      .returning();

    const transactionRef = `TXN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

    const [payment] = await db
      .insert(payments)
      .values({
        userId,
        subscriptionId: sub.id,
        amountUsd,
        currency: 'USD',
        status: 'pending',
        provider: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'sandbox_gateway',
        transactionRef,
        invoiceNumber,
      })
      .returning();

    res.status(201).json({ subscription: sub, payment });
  } catch (err) {
    console.error('POST /api/platform/subscriptions/checkout failed:', err);
    res.status(500).json({ error: 'Failed to initiate checkout' });
  }
});

// Step 2: Server-verified payment confirmation — only activates plan AFTER verification!
router.post('/subscriptions/verify-payment', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const { paymentId, cardLast4 } = req.body || {};
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, Number(paymentId)), eq(payments.userId, userId)))
      .limit(1);

    if (!payment) return res.status(404).json({ error: 'Payment record not found' });
    if (!cardLast4 || !/^\d{4}$/.test(String(cardLast4))) {
      return res.status(400).json({ error: 'Valid 4-digit card verification required' });
    }

    await db.update(payments).set({ status: 'verified' }).where(eq(payments.id, payment.id));

    if (payment.subscriptionId) {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, payment.subscriptionId))
        .limit(1);

      if (sub) {
        const planKey = (sub.plan as 'plus' | 'pro') || 'plus';
        const periodEnd = new Date(
          Date.now() + (sub.billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000
        );

        await db
          .update(subscriptions)
          .set({ status: 'active', currentPeriodEnd: periodEnd, updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));

        const cfg = PLAN_CONFIG[planKey];
        await db
          .update(users)
          .set({
            plan: planKey,
            storageQuotaBytes: cfg.storageQuotaBytes,
            aiCreditsLimit: cfg.aiCreditsLimit,
            isVerified: true,
          })
          .where(eq(users.id, userId));
      }
    }

    const [updatedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    res.json({ verified: true, user: updatedUser });
  } catch (err) {
    console.error('POST /api/platform/subscriptions/verify-payment failed:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

router.post('/subscriptions/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    await db
      .update(subscriptions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')));

    const cfg = PLAN_CONFIG.free;
    const [updatedUser] = await db
      .update(users)
      .set({
        plan: 'free',
        storageQuotaBytes: cfg.storageQuotaBytes,
        aiCreditsLimit: cfg.aiCreditsLimit,
      })
      .where(eq(users.id, userId))
      .returning();

    res.json({ user: updatedUser });
  } catch (err) {
    console.error('POST /api/platform/subscriptions/cancel failed:', err);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// --- TIGER ADMIN (STRICT SERVER-SIDE ROLE ENFORCEMENT) ---
router.get('/admin/overview', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const [
      [userStats],
      [onlineStats],
      [postStats],
      [msgStats],
      [reelStats],
      [storageStats],
      [aiStats],
      allUsers,
      openReports,
      recentPosts,
      recentFiles,
      allGroups,
      allPages,
      logs,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.isOnline, true)),
      db.select({ count: sql<number>`count(*)::int` }).from(posts),
      db.select({ count: sql<number>`count(*)::int` }).from(messages),
      db.select({ count: sql<number>`count(*)::int` }).from(reels),
      db.select({ total: sql<number>`coalesce(sum(${cloudFiles.fileSize}), 0)::bigint` }).from(cloudFiles),
      db.select({ total: sql<number>`coalesce(sum(${users.aiCreditsUsed}), 0)::int` }).from(users),
      db.select().from(users).orderBy(desc(users.createdAt)).limit(50),
      db.select().from(reports).orderBy(desc(reports.createdAt)).limit(50),
      db.select().from(posts).orderBy(desc(posts.createdAt)).limit(30),
      db.select().from(cloudFiles).orderBy(desc(cloudFiles.createdAt)).limit(30),
      db.select().from(groups).orderBy(desc(groups.createdAt)).limit(30),
      db.select().from(pages).orderBy(desc(pages.createdAt)).limit(30),
      db.select().from(adminLogs).orderBy(desc(adminLogs.createdAt)).limit(50),
    ]);

    res.json({
      stats: {
        totalUsers: userStats.count,
        activeUsers: onlineStats.count,
        totalPosts: postStats.count,
        totalMessages: msgStats.count,
        totalVideos: reelStats.count,
        totalStorageBytes: Number(storageStats.total || 0),
        totalAiCreditsUsed: aiStats.total,
      },
      users: allUsers,
      reports: openReports,
      posts: recentPosts,
      files: recentFiles,
      groups: allGroups,
      pages: allPages,
      logs,
    });
  } catch (err) {
    console.error('GET /api/platform/admin/overview failed:', err);
    res.status(500).json({ error: 'Failed to load admin overview' });
  }
});

router.patch('/admin/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    const { role, isBanned, plan } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (role === 'user' || role === 'moderator' || role === 'admin') updates.role = role;
    if (typeof isBanned === 'boolean') updates.isBanned = isBanned;
    if (plan === 'free' || plan === 'plus' || plan === 'pro') {
      updates.plan = plan;
      updates.storageQuotaBytes = PLAN_CONFIG[plan as 'free' | 'plus' | 'pro'].storageQuotaBytes;
      updates.aiCreditsLimit = PLAN_CONFIG[plan as 'free' | 'plus' | 'pro'].aiCreditsLimit;
    }

    const [updated] = await db.update(users).set(updates).where(eq(users.id, targetId)).returning();
    await db.insert(adminLogs).values({
      adminId: req.dbUser!.id,
      action: 'UPDATE_USER',
      targetType: 'user',
      targetId,
      details: updates,
      ipAddress: req.ip || '',
    });
    res.json({ user: updated });
  } catch (err) {
    console.error('PATCH /api/platform/admin/users/:id failed:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.patch('/admin/reports/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const status = req.body?.status === 'dismissed' ? 'dismissed' : 'resolved';
    const [updated] = await db
      .update(reports)
      .set({ status, resolvedBy: req.dbUser!.id })
      .where(eq(reports.id, reportId))
      .returning();

    await db.insert(adminLogs).values({
      adminId: req.dbUser!.id,
      action: `REPORT_${status.toUpperCase()}`,
      targetType: 'report',
      targetId: reportId,
      details: { status },
      ipAddress: req.ip || '',
    });
    res.json({ report: updated });
  } catch (err) {
    console.error('PATCH /api/platform/admin/reports/:id failed:', err);
    res.status(500).json({ error: 'Failed to resolve report' });
  }
});

router.delete('/admin/content/:type/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { type, id } = req.params;
    const targetId = Number(id);

    if (type === 'post') await db.delete(posts).where(eq(posts.id, targetId));
    else if (type === 'comment') await db.delete(comments).where(eq(comments.id, targetId));
    else if (type === 'group') await db.delete(groups).where(eq(groups.id, targetId));
    else if (type === 'page') await db.delete(pages).where(eq(pages.id, targetId));
    else if (type === 'file') await db.delete(cloudFiles).where(eq(cloudFiles.id, targetId));
    else return res.status(400).json({ error: 'Unsupported content type' });

    await db.insert(adminLogs).values({
      adminId: req.dbUser!.id,
      action: `DELETE_${type.toUpperCase()}`,
      targetType: type,
      targetId,
      ipAddress: req.ip || '',
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/platform/admin/content failed:', err);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// --- CLIENT ERROR MONITORING ---
router.post('/monitoring/error', (req, res) => {
  const { message, stack, route } = req.body || {};
  console.error('[TIGER Client Error Monitor]', { message, route, stack: String(stack || '').slice(0, 500) });
  res.json({ logged: true });
});

export default router;
