import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch, ApiError, resolveWsUrl, setMemoryToken, getFreshToken } from '../lib/api';
import { Lang, TRANSLATIONS } from '../lib/i18n';
import { ensureUserE2EEKeyPair } from '../lib/crypto';

export interface DbUser {
  id: number;
  uid: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string;
  role: 'user' | 'moderator' | 'admin';
  isVerified: boolean;
  plan: 'free' | 'plus' | 'pro';
  storageQuotaBytes: number;
  storageUsedBytes: number;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  isOnline: boolean;
  createdAt: string;
}

export interface UserProfile {
  location: string;
  website: string;
  workplace: string;
  education: string;
  birthdate: string;
  privacySettings: {
    profileVisibility: 'public' | 'friends' | 'private';
    messagePrivacy: 'everyone' | 'friends';
    storyPrivacy: 'public' | 'friends';
    showOnlineStatus: boolean;
    allowLocationServices?: boolean;
    shareLiveWithFriends?: boolean;
  };
  notificationSettings: {
    messages: boolean;
    friends: boolean;
    reactions: boolean;
    comments: boolean;
    live: boolean;
  };
  language: Lang;
  theme: 'dark' | 'light';
}

interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  text: string;
}

type WsListener = (event: string, payload: any) => void;

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  user: DbUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signingIn: boolean;
  authError: string | null;
  lang: Lang;
  theme: 'dark' | 'light';
  unreadNotifications: number;
  e2eeKeys: { privateKey: CryptoKey; publicKeyJwk: JsonWebKey; fingerprint: string } | null;
  setLang: (lang: Lang) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: (forceTokenRefresh?: boolean) => Promise<boolean>;
  setUnreadNotifications: React.Dispatch<React.SetStateAction<number>>;
  notifyToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  sendWs: (event: string, payload: any) => void;
  subscribeWs: (listener: WsListener) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatFirebaseAuthError(err: any, lang: Lang): string {
  const code = String(err?.code || '');
  if (code === 'auth/popup-blocked') {
    return lang === 'ar'
      ? 'المتصفح حظر نافذة تسجيل الدخول. يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم المحاولة مجدداً.'
      : 'Browser blocked the sign-in popup. Please allow popups for this site and try again.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return lang === 'ar'
      ? 'تم إغلاق نافذة تسجيل الدخول عبر Google قبل إكمالها.'
      : 'Google sign-in popup was closed before completing.';
  }
  if (code === 'auth/unauthorized-domain') {
    return lang === 'ar'
      ? 'هذا النطاق غير مضاف في قائمة النطاقات المصرح بها داخل Firebase Console.'
      : 'This domain is not authorized in Firebase Authentication settings.';
  }
  if (code === 'auth/network-request-failed') {
    return lang === 'ar'
      ? 'تعذر الاتصال بخدمة Google للمصادقة. تحقق من الاتصال بالإنترنت.'
      : 'Network error connecting to Google Authentication.';
  }
  return err?.message || (lang === 'ar' ? 'فشل تسجيل الدخول عبر Google' : 'Google Sign-In failed');
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<DbUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [lang, setLangState] = useState<Lang>('ar');
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [e2eeKeys, setE2eeKeys] = useState<{
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
    fingerprint: string;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const wsListenersRef = useRef<Set<WsListener>>(new Set());
  const wsReconnectTimerRef = useRef<number | null>(null);
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;

  const notifyToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const applyThemeAndLang = useCallback((newLang: Lang, newTheme: 'dark' | 'light') => {
    document.documentElement.lang = newLang;
    document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr';
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    applyThemeAndLang(lang, theme);
  }, [lang, theme, applyThemeAndLang]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      if (user) {
        void apiFetch('/api/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify({ language: next }),
        }).catch(() => {});
      }
    },
    [user]
  );

  const setTheme = useCallback(
    (next: 'dark' | 'light') => {
      setThemeState(next);
      if (user) {
        void apiFetch('/api/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify({ theme: next }),
        }).catch(() => {});
      }
    },
    [user]
  );

  const closeWebSocket = useCallback(() => {
    if (wsReconnectTimerRef.current !== null) {
      window.clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {
        // Ignore close errors
      }
      wsRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback(async () => {
    const token = await getFreshToken();
    if (!token) return;

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket(resolveWsUrl(`/ws?token=${encodeURIComponent(token)}`));
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as { event: string; payload: any };
        if (parsed.event === 'notification:new') {
          setUnreadNotifications((c) => c + 1);
          notifyToast(`${parsed.payload.title}: ${parsed.payload.body}`, 'info');
        }
        wsListenersRef.current.forEach((fn) => fn(parsed.event, parsed.payload));
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (auth.currentUser) {
        wsReconnectTimerRef.current = window.setTimeout(() => void connectWebSocket(), 3500);
      }
    };
  }, [notifyToast]);

  const refreshUser = useCallback(async (forceTokenRefresh = false): Promise<boolean> => {
    try {
      if (forceTokenRefresh) {
        await getFreshToken(true);
      }

      let data: { user: DbUser; profile: UserProfile | null };
      try {
        data = await apiFetch<{ user: DbUser; profile: UserProfile | null }>('/api/auth/me', {
          timeoutMs: 25_000,
        });
      } catch (firstErr: any) {
        // Retry once if Cloud SQL / server hit a transient cold-start or token skew glitch
        const retryable =
          firstErr?.code !== 'BACKEND_UNAVAILABLE' &&
          (firstErr?.status === 500 ||
            firstErr?.status === 502 ||
            firstErr?.status === 503 ||
            firstErr?.status === 504 ||
            firstErr?.status === 0 ||
            firstErr?.code === 'DB_SYNC_ERROR');
        if (!retryable) throw firstErr;
        await new Promise((r) => setTimeout(r, 900));
        await getFreshToken(true);
        data = await apiFetch<{ user: DbUser; profile: UserProfile | null }>('/api/auth/me', {
          timeoutMs: 25_000,
        });
      }

      if (!data || !data.user || typeof data.user.id !== 'number') {
        throw new ApiError(
          'Backend API returned an unexpected account payload. Please verify the TIGER server is running.',
          502,
          { code: 'BACKEND_UNAVAILABLE' }
        );
      }

      setAuthError(null);
      setUser(data.user);
      setProfile(data.profile ?? null);
      if (data.profile?.language === 'en' || data.profile?.language === 'ar') {
        setLangState(data.profile.language);
      }
      if (data.profile?.theme === 'light' || data.profile?.theme === 'dark') {
        setThemeState(data.profile.theme);
      }

      // Non-critical hydration runs independently so it never blocks account login
      void apiFetch<{ unreadCount: number }>('/api/platform/notifications')
        .then((notifData) => setUnreadNotifications(notifData.unreadCount || 0))
        .catch(() => {});

      void ensureUserE2EEKeyPair(data.user.id)
        .then(async (pair) => {
          setE2eeKeys(pair);
          await apiFetch('/api/auth/public-key', {
            method: 'POST',
            body: JSON.stringify({ publicKeyJwk: pair.publicKeyJwk }),
          });
        })
        .catch(() => {});

      return true;
    } catch (err: any) {
      setUser(null);
      setProfile(null);
      if (err?.code === 'BACKEND_UNAVAILABLE') {
        setAuthError(
          langRef.current === 'ar'
            ? 'هذا النطاق يعرض ملفات الواجهة فقط ولا يتصل بخادم المنصة (/api). يجب ربط الخادم الخلفي بهذا النطاق أو ضبط VITE_API_BASE_URL ليتمكن الحساب من الدخول.'
            : 'This domain only serves static frontend files and is not connected to the TIGER /api backend server.'
        );
      } else {
        setAuthError(
          err?.message ||
            (langRef.current === 'ar'
              ? 'تعذر مزامنة جلسة الحساب مع الخادم. يرجى المحاولة مجدداً.'
              : 'Failed to sync user session with server. Please retry.')
        );
      }
      return false;
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthError(null);
      try {
        if (fbUser) {
          const token = await fbUser.getIdToken();
          setMemoryToken(token);
          const ok = await refreshUser(false);
          if (ok) {
            void connectWebSocket();
          }
        } else {
          setMemoryToken(null);
          setUser(null);
          setProfile(null);
          setE2eeKeys(null);
          setUnreadNotifications(0);
          closeWebSocket();
        }
      } catch (err: any) {
        setAuthError(err?.message || 'Failed to initialize session');
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [refreshUser, connectWebSocket, closeWebSocket]);

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      setFirebaseUser(cred.user);
      const token = await cred.user.getIdToken(true);
      setMemoryToken(token);
      closeWebSocket();
      const ok = await refreshUser(false);
      if (ok) {
        void connectWebSocket();
      }
    } catch (err: any) {
      const msg = formatFirebaseAuthError(err, langRef.current);
      setAuthError(msg);
      notifyToast(msg, 'error');
    } finally {
      setSigningIn(false);
    }
  }, [notifyToast, refreshUser, connectWebSocket, closeWebSocket]);

  const logout = useCallback(async () => {
    closeWebSocket();
    setMemoryToken(null);
    setUser(null);
    setProfile(null);
    setE2eeKeys(null);
    setUnreadNotifications(0);
    setAuthError(null);
    try {
      await signOut(auth);
    } catch {
      // Ignore Firebase signOut error
    }
    setFirebaseUser(null);
  }, [closeWebSocket]);

  const sendWs = useCallback((event: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const subscribeWs = useCallback((listener: WsListener) => {
    wsListenersRef.current.add(listener);
    return () => {
      wsListenersRef.current.delete(listener);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        user,
        profile,
        loading,
        signingIn,
        authError,
        lang,
        theme,
        unreadNotifications,
        e2eeKeys,
        setLang,
        setTheme,
        loginWithGoogle,
        logout,
        refreshUser,
        setUnreadNotifications,
        notifyToast,
        sendWs,
        subscribeWs,
      }}
    >
      {children}
      {/* Toast Notifications Stack */}
      <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:end-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm px-4 py-3 rounded-xl border text-sm font-medium shadow-lg transition-all ${
              t.type === 'error'
                ? 'bg-red-950/95 border-red-800 text-red-100'
                : t.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-800 text-emerald-100'
                : 'bg-zinc-900/95 border-zinc-700 text-zinc-100'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useT() {
  const { lang } = useAuth();
  return TRANSLATIONS[lang];
}
