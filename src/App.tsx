import React, { useState, useEffect } from 'react';
import {
  Home,
  Film,
  Radio,
  MessageSquare,
  Cloud,
  Bot,
  Users,
  Layers,
  Flag,
  User as UserIcon,
  Crown,
  Shield,
  Settings,
  Bell,
  Search,
  Sun,
  Moon,
  Languages,
  Menu,
  X,
  LogIn,
  LogOut,
  FileText,
  MapPin,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { AuthProvider, useAuth, useT } from './context/AuthContext';
import { BrandMark, TIGER_HERO_URL, UserAvatar } from './components/BrandMark';
import { ErrorBoundary, LoadingSkeleton, NotFoundView } from './components/ErrorBoundary';
import { SocialFeedView } from './components/views/SocialFeedView';
import { ReelsView } from './components/views/ReelsView';
import { LiveView } from './components/views/LiveView';
import { ChatView } from './components/views/ChatView';
import { CloudView } from './components/views/CloudView';
import { AiAssistantView } from './components/views/AiAssistantView';
import { TigerMapView } from './components/views/TigerMapView';
import { CommunityView } from './components/views/CommunityView';
import { ProfileView } from './components/views/ProfileView';
import {
  NotificationsView,
  PremiumView,
  AdminPanelView,
  SettingsView,
} from './components/views/PremiumAdminSettingsView';
import { apiFetch, reportClientError } from './lib/api';

type SectionKey =
  | 'feed'
  | 'reels'
  | 'live'
  | 'chat'
  | 'cloud'
  | 'ai'
  | 'map'
  | 'friends'
  | 'groups'
  | 'pages'
  | 'profile'
  | 'notifications'
  | 'premium'
  | 'admin'
  | 'settings'
  | 'not_found';

const SharedFileModal: React.FC<{ token: string; onClose: () => void }> = ({ token, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch(`/api/cloud/shared/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((err: any) => setError(err?.message || 'Unable to access shared link'));
  }, [token]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">TIGER CLOUD — Shared File</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !data ? (
          <LoadingSkeleton rows={1} />
        ) : data.file ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <FileText className="w-6 h-6 text-orange-500" />
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{data.file.fileName}</div>
                <div className="text-xs text-zinc-400">{data.share.permission}</div>
              </div>
            </div>
            <a
              href={data.file.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-colors"
            >
              Open / Download
            </a>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">Shared folder access granted.</p>
        )}
      </div>
    </div>
  );
};

const TigerShell: React.FC = () => {
  const {
    firebaseUser,
    user,
    loading,
    signingIn,
    authError,
    lang,
    theme,
    unreadNotifications,
    setLang,
    setTheme,
    loginWithGoogle,
    logout,
    refreshUser,
  } = useAuth();
  const t = useT();

  const [section, setSection] = useState<SectionKey>('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatTargetUserId, setChatTargetUserId] = useState<number | null>(null);
  const [profileTargetUserId, setProfileTargetUserId] = useState<number | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [retryingSync, setRetryingSync] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('share');
    if (token) setShareToken(token);

    const knownRoutes = new Set([
      '/',
      '/feed',
      '/reels',
      '/live',
      '/chat',
      '/cloud',
      '/ai',
      '/map',
      '/friends',
      '/groups',
      '/pages',
      '/profile',
      '/notifications',
      '/premium',
      '/admin',
      '/settings',
    ]);
    if (window.location.pathname !== '/' && !knownRoutes.has(window.location.pathname)) {
      setSection('not_found');
    }

    const onError = (e: ErrorEvent) => reportClientError(e.error || e.message);
    const onRejection = (e: PromiseRejectionEvent) =>
      reportClientError(e.reason instanceof Error ? e.reason : String(e.reason || 'Unhandled promise rejection'));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Reset cross-account state and protect non-admin routes when user changes
  useEffect(() => {
    setChatTargetUserId(null);
    setProfileTargetUserId(null);
    setSearchQuery('');
    setMobileMenuOpen(false);
    if (!user) {
      setSection((cur) => (cur === 'not_found' ? 'not_found' : 'feed'));
    } else if (user.role !== 'admin' && section === 'admin') {
      setSection('feed');
    }
  }, [user?.id, user?.role]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#09090b] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <BrandMark size="lg" />
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
            <span>{t.common.loading}</span>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated Landing Page (plus stuck-Firebase recovery controls)
  if (!user) {
    const handleRetrySync = async () => {
      setRetryingSync(true);
      try {
        await refreshUser(true);
      } finally {
        setRetryingSync(false);
      }
    };

    const handleSwitchAccount = async () => {
      await logout();
      await loginWithGoogle();
    };

    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 flex flex-col relative overflow-hidden">
        {/* Subtle ambient black & orange architectural glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 start-1/2 -translate-x-1/2 w-[780px] h-[360px] rounded-full bg-orange-500/10 blur-[120px]"
        />

        {shareToken && <SharedFileModal token={shareToken} onClose={() => setShareToken(null)} />}

        <header className="relative z-10 px-6 py-4 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md flex items-center justify-between gap-6">
          <BrandMark size="md" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-orange-500/50 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Languages className="w-4 h-4 text-orange-500" />
              <span>{lang === 'ar' ? 'EN' : 'AR'}</span>
            </button>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-orange-500/50 transition-colors"
              aria-label="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-orange-500/10 border border-orange-500/25 text-xs font-bold text-orange-500 tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              <span>{t.brandTagline}</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-display font-extrabold leading-[1.15] text-balance tracking-tight">
              {t.welcomeTitle}
            </h1>

            <p className="text-base text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-xl">
              {t.welcomeDesc}
            </p>

            {authError && (
              <div className="p-3.5 rounded-xl border border-red-500/35 bg-red-500/10 text-xs text-red-600 dark:text-red-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <span className="leading-relaxed">{authError}</span>
              </div>
            )}

            {firebaseUser ? (
              <div className="p-4 rounded-2xl border border-orange-500/30 bg-white dark:bg-zinc-900/90 space-y-3 shadow-lg">
                <div className="text-xs text-zinc-600 dark:text-zinc-300">
                  {lang === 'ar'
                    ? `تم مصادقة حساب Google (${firebaseUser.email || 'Google Account'}). أكمل الدخول إلى المنصة أو بدّل الحساب:`
                    : `Authenticated as ${firebaseUser.email || 'Google Account'}. Continue into TIGER or switch account:`}
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => void handleRetrySync()}
                    disabled={retryingSync}
                    className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold text-xs inline-flex items-center gap-2 transition-colors"
                  >
                    {retryingSync ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>{lang === 'ar' ? 'إكمال الدخول للمنصة' : 'Continue to TIGER'}</span>
                  </button>
                  <button
                    onClick={() => void handleSwitchAccount()}
                    disabled={signingIn}
                    className="px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
                  >
                    <LogIn className="w-4 h-4 text-orange-500" />
                    <span>{lang === 'ar' ? 'تبديل حساب Google' : 'Switch Google Account'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={() => void loginWithGoogle()}
                  disabled={signingIn}
                  className="px-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold text-sm inline-flex items-center gap-2.5 shadow-lg shadow-orange-500/25 transition-all"
                >
                  {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  <span>{signingIn ? (lang === 'ar' ? 'جاري تسجيل الدخول...' : 'Signing in...') : t.signInGoogle}</span>
                </button>
              </div>
            )}

            <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800/90 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80">
                <div className="font-bold text-zinc-900 dark:text-white">TIGER SOCIAL</div>
                <div className="text-zinc-500 mt-0.5">Posts · Reels · Live</div>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80">
                <div className="font-bold text-zinc-900 dark:text-white">TIGER CHAT</div>
                <div className="text-zinc-500 mt-0.5">E2EE · Calls</div>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80">
                <div className="font-bold text-zinc-900 dark:text-white">CLOUD & AI</div>
                <div className="text-zinc-500 mt-0.5">Drive AI · Chat</div>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80">
                <div className="font-bold text-zinc-900 dark:text-white">TIGER MAP</div>
                <div className="text-zinc-500 mt-0.5">Live GPS · Places</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-2xl aspect-[16/10] bg-black">
              <img
                src={TIGER_HERO_URL}
                alt="TIGER Platform Studio"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
              <div className="absolute bottom-4 inset-x-4 flex items-center justify-between text-xs text-white">
                <span className="font-display font-bold tracking-wide">TIGER ECOSYSTEM</span>
                <span className="px-2.5 py-1 rounded-lg bg-orange-500/90 font-semibold">
                  {lang === 'ar' ? 'تسجيل دخول آمن عبر Google' : 'Secured with Google Auth'}
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const navItems: Array<{ key: SectionKey; label: string; icon: any; badge?: number }> = [
    { key: 'feed', label: t.nav.feed, icon: Home },
    { key: 'reels', label: t.nav.reels, icon: Film },
    { key: 'live', label: t.nav.live, icon: Radio },
    { key: 'chat', label: t.nav.chat, icon: MessageSquare },
    { key: 'cloud', label: t.nav.cloud, icon: Cloud },
    { key: 'ai', label: t.nav.ai, icon: Bot },
    { key: 'map', label: t.nav.map, icon: MapPin },
    { key: 'friends', label: t.nav.friends, icon: Users },
    { key: 'groups', label: t.nav.groups, icon: Layers },
    { key: 'pages', label: t.nav.pages, icon: Flag },
    { key: 'profile', label: t.nav.profile, icon: UserIcon },
    { key: 'notifications', label: t.nav.notifications, icon: Bell, badge: unreadNotifications },
    { key: 'premium', label: t.nav.premium, icon: Crown },
    ...(user.role === 'admin' ? [{ key: 'admin' as SectionKey, label: t.nav.admin, icon: Shield }] : []),
    { key: 'settings', label: t.nav.settings, icon: Settings },
  ];

  const openDirectChat = (targetId: number) => {
    setChatTargetUserId(targetId);
    setSection('chat');
  };

  const openUserProfile = (targetId: number) => {
    setProfileTargetUserId(targetId);
    setSection('profile');
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 flex flex-col">
      {shareToken && <SharedFileModal token={shareToken} onClose={() => setShareToken(null)} />}

      {/* Top Header */}
      <header className="sticky top-0 z-30 h-16 px-4 lg:px-6 border-b border-zinc-200 dark:border-zinc-800/90 bg-white/90 dark:bg-[#09090b]/90 backdrop-blur-md flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="lg:hidden p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button
            onClick={() => {
              setProfileTargetUserId(null);
              setSection('feed');
            }}
          >
            <BrandMark size="sm" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-md relative">
          <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5 pointer-events-none" />
          <input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (section !== 'feed') setSection('feed');
            }}
            placeholder={t.searchPlaceholder}
            className="w-full ps-9 pe-8 py-2 rounded-xl text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute end-2.5 top-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSection('notifications')}
            className="relative p-2 rounded-xl border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            title={t.nav.notifications}
          >
            <Bell className="w-4 h-4" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {unreadNotifications}
              </span>
            )}
          </button>

          <button
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className="px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-orange-500/50 text-xs font-semibold hidden sm:inline-flex items-center gap-1 transition-colors"
          >
            <Languages className="w-3.5 h-3.5 text-orange-500" /> {lang === 'ar' ? 'EN' : 'AR'}
          </button>

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-orange-500/50 transition-colors"
            title="Theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            onClick={() => {
              setProfileTargetUserId(null);
              setSection('profile');
            }}
            className="flex items-center gap-2 ps-1.5 py-1 pe-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <UserAvatar src={user.avatarUrl} name={user.displayName} size="sm" isOnline />
            <span className="hidden md:inline text-xs font-semibold max-w-[110px] truncate">
              {user.displayName}
            </span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative">
        {/* Mobile Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 top-16 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
          />
        )}

        {/* Desktop & Mobile Sidebar */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-16 start-0 z-40 flex' : 'hidden'
          } lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:flex flex-col justify-between w-64 shrink-0 border-e border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-[#0c0c0f] p-3 overflow-y-auto`}
        >
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === 'profile') setProfileTargetUserId(null);
                    setSection(item.key);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                    active
                      ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-zinc-500 dark:text-zinc-400'}`} />
                    <span>{item.label}</span>
                  </span>
                  {item.badge && item.badge > 0 ? (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums ${
                        active ? 'bg-black/25 text-white' : 'bg-orange-500/15 text-orange-500'
                      }`}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Compact Sidebar Account Card */}
          <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800/90">
            <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  setProfileTargetUserId(null);
                  setSection('profile');
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-2 min-w-0 text-start"
              >
                <UserAvatar src={user.avatarUrl} name={user.displayName} size="xs" isOnline />
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{user.displayName}</div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    @{user.username} · <span className="uppercase text-orange-500 font-semibold">{user.plan}</span>
                  </div>
                </div>
              </button>
              <button
                onClick={() => void logout()}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 shrink-0 transition-colors"
                title={t.signOut}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 p-4 lg:p-6 min-w-0 overflow-x-hidden">
          <ErrorBoundary onReset={() => setSection('feed')}>
            {section === 'feed' && (
              <SocialFeedView
                searchQuery={searchQuery}
                onOpenProfile={openUserProfile}
                onOpenChat={openDirectChat}
              />
            )}
            {section === 'reels' && <ReelsView />}
            {section === 'live' && <LiveView />}
            {section === 'chat' && <ChatView initialTargetUserId={chatTargetUserId} />}
            {section === 'cloud' && <CloudView />}
            {section === 'ai' && <AiAssistantView />}
            {section === 'map' && <TigerMapView />}
            {(section === 'friends' || section === 'groups' || section === 'pages') && (
              <CommunityView
                section={section}
                onOpenChat={openDirectChat}
                onOpenProfile={openUserProfile}
              />
            )}
            {section === 'profile' && (
              <ProfileView targetUserId={profileTargetUserId} onOpenChat={openDirectChat} />
            )}
            {section === 'notifications' && <NotificationsView />}
            {section === 'premium' && <PremiumView />}
            {section === 'admin' && <AdminPanelView />}
            {section === 'settings' && <SettingsView />}
            {section === 'not_found' && (
              <NotFoundView
                onGoHome={() => setSection('feed')}
                title={t.common.notFoundTitle}
                desc={t.common.notFoundDesc}
                homeLabel={t.common.backHome}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <TigerShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
