import React, { useState, useEffect, useCallback } from 'react';
import {
  Crown,
  Check,
  Shield,
  Users,
  FileText,
  HardDrive,
  Bot,
  MessageSquare,
  Video,
  Flag,
  Download,
  LogOut,
  Trash2,
  Bell,
  CreditCard,
  X,
  MapPin,
  Square,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth, useT } from '../../context/AuthContext';
import { LoadingSkeleton } from '../ErrorBoundary';

export const NotificationsView: React.FC = () => {
  const { lang, setUnreadNotifications, notifyToast } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ notifications: any[]; unreadCount: number }>('/api/platform/notifications');
      setItems(res.notifications || []);
      setUnreadNotifications(res.unreadCount || 0);
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load notifications', 'error');
    } finally {
      setLoading(false);
    }
  }, [setUnreadNotifications, notifyToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold flex items-center gap-2">
          <Bell className="w-5 h-5 text-orange-500" />
          {lang === 'ar' ? 'الإشعارات الفورية' : 'Notifications'}
        </h2>
        <button
          onClick={() =>
            void apiFetch('/api/platform/notifications/read-all', { method: 'POST' })
              .then(() => load())
              .catch((err: any) => notifyToast(err?.message || 'Failed to mark notifications read', 'error'))
          }
          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold"
        >
          {lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center text-sm text-zinc-500">
          {lang === 'ar' ? 'لا توجد إشعارات جديدة' : 'You are all caught up!'}
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((n) => (
            <div key={n.id} className={`p-4 flex items-start justify-between gap-3 ${!n.isRead ? 'bg-orange-500/5' : ''}`}>
              <div>
                <div className="text-sm font-bold">{n.title}</div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{n.body}</p>
              </div>
              <span className="text-[11px] text-zinc-400 tabular-nums shrink-0">
                {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const PremiumView: React.FC = () => {
  const { user, lang, notifyToast, refreshUser } = useAuth();
  const [data, setData] = useState<{ currentPlan: string; stripeConfigured: boolean; invoices: any[] } | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutPayment, setCheckoutPayment] = useState<{ id: number; amountUsd: number; plan: string } | null>(null);
  const [cardLast4, setCardLast4] = useState('');
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/api/platform/subscriptions');
      setData(res);
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load plans', 'error');
    }
  }, [notifyToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCheckout = async (plan: 'plus' | 'pro') => {
    try {
      const res = await apiFetch<{ payment: { id: number; amountUsd: number } }>(
        '/api/platform/subscriptions/checkout',
        { method: 'POST', body: JSON.stringify({ plan, billingCycle }) }
      );
      setCheckoutPayment({ id: res.payment.id, amountUsd: res.payment.amountUsd, plan });
      setCardLast4('');
    } catch (err: any) {
      notifyToast(err?.message || 'Checkout failed', 'error');
    }
  };

  const confirmPayment = async () => {
    if (!checkoutPayment) return;
    setVerifying(true);
    try {
      await apiFetch('/api/platform/subscriptions/verify-payment', {
        method: 'POST',
        body: JSON.stringify({ paymentId: checkoutPayment.id, cardLast4 }),
      });
      setCheckoutPayment(null);
      await refreshUser();
      await load();
      notifyToast(lang === 'ar' ? 'تم التحقق من الدفع وتفعيل الخطة' : 'Payment verified & plan activated', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Verification failed', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const plans = [
    {
      key: 'free',
      name: 'FREE',
      price: 0,
      storage: '100 MB',
      aiCredits: '30 / mo',
      descAr: 'للاستخدام اليومي الأساسي',
      descEn: 'Essential everyday access',
    },
    {
      key: 'plus',
      name: 'TIGER PLUS',
      price: billingCycle === 'yearly' ? 90 : 9,
      storage: '5 GB',
      aiCredits: '300 / mo',
      descAr: 'للمبدعين والطلاب',
      descEn: 'For creators & power users',
    },
    {
      key: 'pro',
      name: 'TIGER PRO',
      price: billingCycle === 'yearly' ? 240 : 24,
      storage: '50 GB',
      aiCredits: '2,000 / mo',
      descAr: 'للفرق والشركات',
      descEn: 'For teams & professionals',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-orange-500" /> TIGER PREMIUM
          </h2>
          <p className="text-xs text-zinc-500">
            {lang === 'ar'
              ? 'لا يتم تفعيل أي خطة مدفوعة إلا بعد إتمام الدفع والتحقق منه عبر الخادم.'
              : 'Paid plans activate strictly after server-side payment verification.'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-3 py-1.5 rounded-lg font-semibold ${billingCycle === 'monthly' ? 'bg-orange-500 text-white' : ''}`}
          >
            {lang === 'ar' ? 'شهري' : 'Monthly'}
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-3 py-1.5 rounded-lg font-semibold ${billingCycle === 'yearly' ? 'bg-orange-500 text-white' : ''}`}
          >
            {lang === 'ar' ? 'سنوي' : 'Yearly'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {plans.map((p) => {
          const isCurrent = user?.plan === p.key;
          return (
            <div
              key={p.key}
              className={`rounded-2xl border p-6 space-y-5 bg-white dark:bg-zinc-900 ${
                p.key === 'plus' ? 'border-orange-500' : 'border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <div>
                <h3 className="text-lg font-display font-bold">{p.name}</h3>
                <p className="text-xs text-zinc-500 mt-1">{lang === 'ar' ? p.descAr : p.descEn}</p>
              </div>
              <div className="text-3xl font-display font-extrabold tabular-nums">
                ${p.price}
                <span className="text-xs font-normal text-zinc-500">
                  /{billingCycle === 'yearly' ? (lang === 'ar' ? 'سنة' : 'yr') : lang === 'ar' ? 'شهر' : 'mo'}
                </span>
              </div>
              <ul className="space-y-2 text-xs text-zinc-700 dark:text-zinc-300">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-orange-500" /> {lang === 'ar' ? 'تخزين سحابي:' : 'Cloud:'} {p.storage}
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-orange-500" /> TIGER AI: {p.aiCredits}
                </li>
              </ul>

              {isCurrent ? (
                <div className="space-y-2">
                  <div className="w-full py-2 text-center rounded-xl bg-emerald-500/15 text-emerald-500 text-xs font-bold">
                    {lang === 'ar' ? 'خطتك الحالية' : 'Current Active Plan'}
                  </div>
                  {p.key !== 'free' && (
                    <button
                      onClick={() =>
                        void apiFetch('/api/platform/subscriptions/cancel', { method: 'POST' })
                          .then(async () => {
                            await refreshUser();
                            await load();
                            notifyToast(lang === 'ar' ? 'تم إلغاء الاشتراك' : 'Subscription cancelled', 'info');
                          })
                          .catch((err: any) => notifyToast(err?.message || 'Cancel failed', 'error'))
                      }
                      className="w-full py-1.5 text-xs text-red-500 hover:underline"
                    >
                      {lang === 'ar' ? 'إلغاء الاشتراك' : 'Cancel Subscription'}
                    </button>
                  )}
                </div>
              ) : p.key !== 'free' ? (
                <button
                  onClick={() => void startCheckout(p.key as 'plus' | 'pro')}
                  className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold"
                >
                  {lang === 'ar' ? 'الترقية والدفع' : 'Upgrade & Verify Payment'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Invoices Table */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
        <h3 className="text-sm font-bold">{lang === 'ar' ? 'سجل الفواتير' : 'Invoice History'}</h3>
        {!data?.invoices?.length ? (
          <p className="text-xs text-zinc-500">{lang === 'ar' ? 'لا توجد فواتير بعد' : 'No invoices yet'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="py-2 text-start">{lang === 'ar' ? 'رقم الفاتورة' : 'Invoice'}</th>
                  <th className="py-2 text-start">{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  <th className="py-2 text-start">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-2 text-start">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 tabular-nums">
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2.5 font-mono">{inv.invoiceNumber}</td>
                    <td className="py-2.5">${inv.amountUsd}</td>
                    <td className="py-2.5">{inv.status}</td>
                    <td className="py-2.5">{new Date(inv.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {checkoutPayment && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-orange-500" />{' '}
                {lang === 'ar' ? 'التحقق من الدفع' : 'Verify Checkout Payment'}
              </h3>
              <button onClick={() => setCheckoutPayment(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-400">
              {lang === 'ar'
                ? `الخطة: ${checkoutPayment.plan.toUpperCase()} — المبلغ: $${checkoutPayment.amountUsd}. أدخل آخر 4 أرقام للتحقق من المعاملة.`
                : `Plan: ${checkoutPayment.plan.toUpperCase()} — Amount: $${checkoutPayment.amountUsd}. Enter 4 digits to verify transaction.`}
            </p>
            <input
              value={cardLast4}
              onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4242"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm font-mono text-center"
            />
            <button
              onClick={() => void confirmPayment()}
              disabled={verifying || cardLast4.length !== 4}
              className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-sm font-semibold"
            >
              {verifying ? '...' : lang === 'ar' ? 'تأكيد وتفعيل الخطة' : 'Confirm & Activate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const AdminPanelView: React.FC = () => {
  const { lang, notifyToast } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch('/api/platform/admin/overview');
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Admin access denied');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center text-sm text-red-400">
        {error}
      </div>
    );
  }
  if (!data) return <LoadingSkeleton rows={4} />;

  const s = data.stats;
  const kpis = [
    { label: lang === 'ar' ? 'المستخدمون' : 'Total Users', val: s.totalUsers, icon: Users },
    { label: lang === 'ar' ? 'النشطون الآن' : 'Active Online', val: s.activeUsers, icon: Shield },
    { label: lang === 'ar' ? 'المنشورات' : 'Posts', val: s.totalPosts, icon: FileText },
    { label: lang === 'ar' ? 'الرسائل' : 'Messages', val: s.totalMessages, icon: MessageSquare },
    { label: lang === 'ar' ? 'الفيديوهات' : 'Reels Videos', val: s.totalVideos, icon: Video },
    { label: lang === 'ar' ? 'التخزين (MB)' : 'Storage (MB)', val: Math.round(s.totalStorageBytes / 1048576), icon: HardDrive },
    { label: lang === 'ar' ? 'استهلاك AI' : 'AI Requests', val: s.totalAiCreditsUsed, icon: Bot },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-xl font-display font-bold flex items-center gap-2">
        <Shield className="w-5 h-5 text-orange-500" /> TIGER ADMIN
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <Icon className="w-4 h-4 text-orange-500 mb-2" />
              <div className="text-xl font-display font-bold tabular-nums">{k.val}</div>
              <div className="text-[11px] text-zinc-500">{k.label}</div>
            </div>
          );
        })}
      </div>

      {/* Users Management */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
        <h3 className="text-sm font-bold">{lang === 'ar' ? 'إدارة المستخدمين والصلاحيات' : 'User & Role Management'}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-2 text-start">User</th>
                <th className="py-2 text-start">Role</th>
                <th className="py-2 text-start">Plan</th>
                <th className="py-2 text-start">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.users.map((u: any) => (
                <tr key={u.id}>
                  <td className="py-2.5">
                    <div className="font-bold">{u.displayName}</div>
                    <div className="text-zinc-500">{u.email}</div>
                  </td>
                  <td className="py-2.5">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        void apiFetch(`/api/platform/admin/users/${u.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ role: e.target.value }),
                        })
                          .then(() => {
                            notifyToast(lang === 'ar' ? 'تم تحديث الصلاحية' : 'Role updated', 'success');
                            void load();
                          })
                          .catch((err: any) => notifyToast(err?.message || 'Role update failed', 'error'))
                      }
                      className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-950"
                    >
                      <option value="user">user</option>
                      <option value="moderator">moderator</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-2.5 uppercase font-mono">{u.plan}</td>
                  <td className="py-2.5">
                    <button
                      onClick={() =>
                        void apiFetch(`/api/platform/admin/users/${u.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isBanned: !u.isBanned }),
                        })
                          .then(() => load())
                          .catch((err: any) => notifyToast(err?.message || 'Action failed', 'error'))
                      }
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        u.isBanned ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
                      }`}
                    >
                      {u.isBanned ? (lang === 'ar' ? 'فك الحظر' : 'Unban') : lang === 'ar' ? 'حظر' : 'Ban'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reports & Security Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Flag className="w-4 h-4 text-orange-500" /> {lang === 'ar' ? 'البلاغات' : 'Reports'}
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.reports.length === 0 ? (
              <p className="text-xs text-zinc-500">{lang === 'ar' ? 'لا توجد بلاغات' : 'No reports'}</p>
            ) : (
              data.reports.map((r: any) => (
                <div key={r.id} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold">
                      {r.targetType} #{r.targetId} · {r.status}
                    </div>
                    <div className="text-zinc-500">{r.reason}</div>
                  </div>
                  {r.status === 'open' && (
                    <button
                      onClick={() =>
                        void apiFetch(`/api/platform/admin/reports/${r.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'resolved' }),
                        })
                          .then(() => load())
                          .catch((err: any) => notifyToast(err?.message || 'Failed to resolve report', 'error'))
                      }
                      className="px-2.5 py-1 rounded bg-orange-500 text-white"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
          <h3 className="text-sm font-bold">{lang === 'ar' ? 'سجلات الأمان الإدارية' : 'Security Audit Logs'}</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-[11px]">
            {data.logs.map((l: any) => (
              <div key={l.id} className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 flex justify-between">
                <span>
                  {l.action} · {l.targetType} #{l.targetId}
                </span>
                <span className="text-zinc-500">{new Date(l.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SettingsView: React.FC = () => {
  const { user, profile, lang, theme, setLang, setTheme, logout, notifyToast, refreshUser } = useAuth();
  const t = useT();

  const [sessions, setSessions] = useState<any[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>(
    profile?.privacySettings?.profileVisibility || 'public'
  );
  const [allowLocationServices, setAllowLocationServices] = useState(
    profile?.privacySettings?.allowLocationServices ?? false
  );
  const [shareLiveWithFriends, setShareLiveWithFriends] = useState(
    profile?.privacySettings?.shareLiveWithFriends ?? false
  );
  const [notifMessages, setNotifMessages] = useState(profile?.notificationSettings?.messages ?? true);
  const [notifReactions, setNotifReactions] = useState(profile?.notificationSettings?.reactions ?? true);
  const [locBusy, setLocBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void apiFetch<{ sessions: any[] }>('/api/auth/sessions')
      .then((res) => setSessions(res.sessions || []))
      .catch(() => {});
  }, []);

  const saveSettings = async () => {
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          privacySettings: {
            profileVisibility: visibility,
            messagePrivacy: 'everyone',
            storyPrivacy: 'public',
            showOnlineStatus: true,
            allowLocationServices,
            shareLiveWithFriends,
          },
          notificationSettings: {
            messages: notifMessages,
            friends: true,
            reactions: notifReactions,
            comments: true,
            live: true,
          },
        }),
      });
      await refreshUser();
      notifyToast(lang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Save failed', 'error');
    }
  };

  const stopAllLiveLocation = async () => {
    setLocBusy(true);
    try {
      await apiFetch('/api/location/live/stop-all', { method: 'POST', body: JSON.stringify({}) });
      notifyToast(
        lang === 'ar' ? 'تم إيقاف جميع مشاركات الموقع المباشر' : 'All live location sharing stopped',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to stop live location', 'error');
    } finally {
      setLocBusy(false);
    }
  };

  const deleteAllLocationData = async () => {
    setLocBusy(true);
    try {
      await apiFetch('/api/location/me', { method: 'DELETE' });
      setAllowLocationServices(false);
      setShareLiveWithFriends(false);
      await refreshUser();
      notifyToast(
        lang === 'ar' ? 'تم حذف جميع بيانات الموقع نهائياً' : 'All location data deleted permanently',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to delete location data', 'error');
    } finally {
      setLocBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-xl font-display font-bold">{t.nav.settings}</h2>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
        <h3 className="text-sm font-bold">{lang === 'ar' ? 'المظهر واللغة' : 'Appearance & Language'}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5">
            <label className="text-zinc-500">{lang === 'ar' ? 'اللغة' : 'Language'}</label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as 'ar' | 'en')}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
            >
              <option value="ar">العربية (RTL)</option>
              <option value="en">English (LTR)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-zinc-500">{lang === 'ar' ? 'الوضع' : 'Theme'}</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
            >
              <option value="dark">{lang === 'ar' ? 'الوضع الليلي' : 'Dark Mode'}</option>
              <option value="light">{lang === 'ar' ? 'الوضع النهاري' : 'Light Mode'}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
        <h3 className="text-sm font-bold">{lang === 'ar' ? 'الخصوصية والإشعارات' : 'Privacy & Notifications'}</h3>
        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-zinc-500 mb-1">
              {lang === 'ar' ? 'ظهور الملف الشخصي' : 'Profile Visibility'}
            </label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
            >
              <option value="public">{lang === 'ar' ? 'عام' : 'Public'}</option>
              <option value="friends">{lang === 'ar' ? 'الأصدقاء فقط' : 'Friends Only'}</option>
              <option value="private">{lang === 'ar' ? 'خاص' : 'Private'}</option>
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notifMessages} onChange={(e) => setNotifMessages(e.target.checked)} />
            <span>{lang === 'ar' ? 'إشعارات الرسائل الفورية' : 'Instant Message Notifications'}</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notifReactions} onChange={(e) => setNotifReactions(e.target.checked)} />
            <span>{lang === 'ar' ? 'إشعارات التفاعلات والتعليقات' : 'Reactions & Comments Notifications'}</span>
          </label>

          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <div className="font-bold flex items-center gap-1.5 text-orange-500">
              <MapPin className="w-4 h-4" />
              <span>{lang === 'ar' ? 'خصوصية الموقع الجغرافي (TIGER LOCATION)' : 'Location Privacy (TIGER LOCATION)'}</span>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowLocationServices}
                onChange={(e) => setAllowLocationServices(e.target.checked)}
              />
              <span>
                {lang === 'ar'
                  ? 'السماح بميزات الموقع في TIGER عند طلبي الصريح فقط'
                  : 'Allow TIGER location features on explicit request only'}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shareLiveWithFriends}
                onChange={(e) => setShareLiveWithFriends(e.target.checked)}
              />
              <span>
                {lang === 'ar'
                  ? 'السماح للأصدقاء برؤية مواقعي المباشرة التي أوافق على مشاركتها'
                  : 'Allow friends to see live locations when I explicitly share them'}
              </span>
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={locBusy}
                onClick={() => void stopAllLiveLocation()}
                className="px-3 py-1.5 rounded-xl bg-amber-600/15 text-amber-500 font-semibold inline-flex items-center gap-1.5"
              >
                <Square className="w-3.5 h-3.5" />
                <span>{lang === 'ar' ? 'إيقاف مشاركة الموقع الآن' : 'Stop Location Sharing'}</span>
              </button>
              <button
                type="button"
                disabled={locBusy}
                onClick={() => void deleteAllLocationData()}
                className="px-3 py-1.5 rounded-xl bg-red-600/15 text-red-500 font-semibold inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{lang === 'ar' ? 'حذف بيانات الموقع المخزنة' : 'Delete Stored Location Data'}</span>
              </button>
            </div>
          </div>

          <button
            onClick={() => void saveSettings()}
            className="px-4 py-2 rounded-xl bg-orange-500 text-white font-semibold"
          >
            {t.common.save}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
        <h3 className="text-sm font-bold">{lang === 'ar' ? 'الأجهزة المتصلة والأمان' : 'Connected Devices & Security'}</h3>
        <p className="text-xs text-zinc-500">
          {lang === 'ar'
            ? `الحساب محمي بمصادقة Google الآمنة (${user?.email}).`
            : `Protected via Google Authentication (${user?.email}).`}
        </p>
        <div className="space-y-2 max-h-44 overflow-y-auto text-xs">
          {sessions.map((s) => (
            <div key={s.id} className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 flex justify-between">
              <span className="truncate max-w-[70%]">{s.deviceInfo}</span>
              <span className="text-zinc-500 tabular-nums">{new Date(s.lastActiveAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-wrap gap-3 justify-between items-center">
        <button
          onClick={async () => {
            try {
              const exportData = await apiFetch('/api/auth/export');
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `tiger-data-${user?.username || 'export'}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            } catch (err: any) {
              notifyToast(err?.message || 'Export failed', 'error');
            }
          }}
          className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" /> {lang === 'ar' ? 'تنزيل بيانات الحساب' : 'Download Account Data'}
        </button>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => void logout()}
            className="px-4 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-xs font-semibold inline-flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" /> {t.signOut}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 rounded-xl bg-red-600/15 text-red-500 text-xs font-semibold inline-flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> {lang === 'ar' ? 'حذف الحساب' : 'Delete Account'}
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 px-3 py-1.5 rounded-xl">
              <span className="text-[11px] text-red-500 font-semibold">
                {lang === 'ar' ? 'تأكيد الحذف النهائي؟' : 'Confirm delete?'}
              </span>
              <button
                onClick={async () => {
                  try {
                    await apiFetch('/api/auth/account', { method: 'DELETE' });
                    await logout();
                  } catch (err: any) {
                    notifyToast(err?.message || 'Delete failed', 'error');
                    setConfirmDelete(false);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-semibold"
              >
                {lang === 'ar' ? 'نعم، احذف' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-[11px]"
              >
                {t.common.cancel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
