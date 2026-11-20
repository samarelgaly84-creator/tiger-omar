import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  UserCheck,
  UserX,
  MessageSquare,
  ShieldBan,
  Search,
  Users,
  Flag,
  Plus,
  Check,
  X,
  BarChart3,
  Globe,
  Lock,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { UserAvatar } from '../BrandMark';
import { LoadingSkeleton } from '../ErrorBoundary';

interface SimpleUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  isOnline: boolean;
}

export const CommunityView: React.FC<{
  section: 'friends' | 'groups' | 'pages';
  onOpenChat: (userId: number) => void;
  onOpenProfile: (userId: number) => void;
}> = ({ section, onOpenChat, onOpenProfile }) => {
  const { user, lang, notifyToast } = useAuth();
  const [loading, setLoading] = useState(true);

  // Friends state
  const [friendsData, setFriendsData] = useState<{
    friends: SimpleUser[];
    incomingRequests: any[];
    outgoingRequests: any[];
    suggestions: SimpleUser[];
    blocked: SimpleUser[];
  }>({ friends: [], incomingRequests: [], outgoingRequests: [], suggestions: [], blocked: [] });
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SimpleUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  // Groups state
  const [groups, setGroups] = useState<any[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupPrivacy, setGroupPrivacy] = useState<'public' | 'private'>('public');
  const [manageGroupId, setManageGroupId] = useState<number | null>(null);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);

  // Pages state
  const [pages, setPages] = useState<any[]>([]);
  const [showCreatePage, setShowCreatePage] = useState(false);
  const [pageName, setPageName] = useState('');
  const [pageCat, setPageCat] = useState('Technology');
  const [pageDesc, setPageDesc] = useState('');
  const [pageBusiness, setPageBusiness] = useState(true);
  const [pagePostText, setPagePostText] = useState<Record<number, string>>({});

  const loadSection = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'friends') {
        const res = await apiFetch<typeof friendsData>('/api/community/friends');
        setFriendsData(res);
      } else if (section === 'groups') {
        const res = await apiFetch<{ groups: any[] }>('/api/community/groups');
        setGroups(res.groups || []);
      } else if (section === 'pages') {
        const res = await apiFetch<{ pages: any[] }>('/api/community/pages');
        setPages(res.pages || []);
      }
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load community data', 'error');
    } finally {
      setLoading(false);
    }
  }, [section, notifyToast]);

  useEffect(() => {
    void loadSection();
  }, [loadSection]);

  useEffect(() => {
    const trimmed = userSearch.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchingUsers(false);
      return;
    }

    let cancelled = false;
    setSearchingUsers(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ users: SimpleUser[] }>(
          `/api/community/users/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!cancelled) {
          setSearchResults((res.users || []).filter((u) => u.id !== user?.id));
        }
      } catch (err: any) {
        if (!cancelled) {
          setSearchResults([]);
          notifyToast(err?.message || (lang === 'ar' ? 'تعذر البحث عن الحسابات' : 'Failed to search users'), 'error');
        }
      } finally {
        if (!cancelled) {
          setSearchingUsers(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userSearch, user?.id, lang, notifyToast]);

  const openGroupMembers = async (groupId: number) => {
    setManageGroupId(groupId);
    try {
      const res = await apiFetch<{ members: any[] }>(`/api/community/groups/${groupId}/members`);
      setGroupMembers(res.members || []);
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load members', 'error');
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <LoadingSkeleton rows={3} />
      </div>
    );
  }

  if (section === 'friends') {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-display font-bold">TIGER FRIENDS</h2>
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5" />
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'ابحث بالاسم، @username، أو البريد الإلكتروني...'
                  : 'Search by name, @username, or email...'
              }
              className="w-full ps-9 pe-8 py-2 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
            />
            {userSearch && (
              <button
                onClick={() => setUserSearch('')}
                className="absolute end-2.5 top-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {userSearch.trim() && (
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{lang === 'ar' ? 'نتائج البحث' : 'Search Results'}</h3>
              {searchingUsers && (
                <span className="text-xs text-zinc-500">{lang === 'ar' ? 'جاري البحث...' : 'Searching...'}</span>
              )}
            </div>
            {!searchingUsers && searchResults.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {lang === 'ar'
                  ? `لم يتم العثور على حساب مطابق لـ "${userSearch.trim()}". تأكد أن الحساب سجّل الدخول إلى TIGER مرة واحدة على الأقل.`
                  : `No matching account found for "${userSearch.trim()}". Accounts appear once they sign in to TIGER.`}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <button onClick={() => onOpenProfile(u.id)} className="flex items-center gap-3 text-start min-w-0">
                      <UserAvatar src={u.avatarUrl} name={u.displayName} size="sm" isOnline={u.isOnline} />
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate">{u.displayName}</div>
                        <div className="text-xs text-zinc-500 truncate">@{u.username}</div>
                      </div>
                    </button>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => onOpenChat(u.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                        title={lang === 'ar' ? 'مراسلة' : 'Message'}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'مراسلة' : 'Chat'}</span>
                      </button>
                      <button
                        onClick={() =>
                          void apiFetch('/api/community/friends/request', {
                            method: 'POST',
                            body: JSON.stringify({ receiverId: u.id }),
                          })
                            .then(() => notifyToast(lang === 'ar' ? 'تم إرسال الطلب' : 'Request sent', 'success'))
                            .catch((err: any) => notifyToast(err?.message || 'Failed to send request', 'error'))
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
                        title={lang === 'ar' ? 'إضافة صديق' : 'Add Friend'}
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          void apiFetch(`/api/community/block/${u.id}`, { method: 'POST' })
                            .then(() => loadSection())
                            .catch((err: any) => notifyToast(err?.message || 'Block failed', 'error'))
                        }
                        className="p-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-500"
                        title="Block"
                      >
                        <ShieldBan className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Incoming Requests */}
        {friendsData.incomingRequests.length > 0 && (
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
            <h3 className="text-sm font-bold text-orange-500">
              {lang === 'ar' ? 'طلبات الصداقة الواردة' : 'Incoming Friend Requests'} ({friendsData.incomingRequests.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {friendsData.incomingRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <UserAvatar src={req.sender?.avatarUrl} name={req.sender?.displayName || 'U'} size="sm" />
                    <div>
                      <div className="text-sm font-bold">{req.sender?.displayName}</div>
                      <div className="text-xs text-zinc-500">@{req.sender?.username}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() =>
                        void apiFetch('/api/community/friends/respond', {
                          method: 'POST',
                          body: JSON.stringify({ requestId: req.id, action: 'accept' }),
                        })
                          .then(() => loadSection())
                          .catch((err: any) => notifyToast(err?.message || 'Action failed', 'error'))
                      }
                      className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold"
                    >
                      {lang === 'ar' ? 'قبول' : 'Accept'}
                    </button>
                    <button
                      onClick={() =>
                        void apiFetch('/api/community/friends/respond', {
                          method: 'POST',
                          body: JSON.stringify({ requestId: req.id, action: 'reject' }),
                        })
                          .then(() => loadSection())
                          .catch((err: any) => notifyToast(err?.message || 'Action failed', 'error'))
                      }
                      className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs"
                    >
                      {lang === 'ar' ? 'رفض' : 'Decline'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Friends List */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <h3 className="text-sm font-bold">
            {lang === 'ar' ? 'الأصدقاء' : 'My Friends'} ({friendsData.friends.length})
          </h3>
          {friendsData.friends.length === 0 ? (
            <p className="text-xs text-zinc-500">
              {lang === 'ar' ? 'لا يوجد أصدقاء بعد. أضف أصدقاء من الاقتراحات أدناه!' : 'No friends yet. Connect with people below!'}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {friendsData.friends.map((f) => (
                <div key={f.id} className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <button onClick={() => onOpenProfile(f.id)} className="flex items-center gap-2.5 text-start min-w-0">
                    <UserAvatar src={f.avatarUrl} name={f.displayName} size="sm" isOnline={f.isOnline} />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{f.displayName}</div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {f.isOnline ? (lang === 'ar' ? 'متصل' : 'Online') : `@${f.username}`}
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onOpenChat(f.id)}
                      className="p-2 rounded-lg bg-orange-500 text-white"
                      title="Message"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        void apiFetch(`/api/community/friends/${f.id}`, { method: 'DELETE' })
                          .then(() => loadSection())
                          .catch((err: any) => notifyToast(err?.message || 'Unfriend failed', 'error'))
                      }
                      className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-red-500"
                      title="Unfriend"
                    >
                      <UserX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Suggestions */}
        {friendsData.suggestions.length > 0 && (
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <h3 className="text-sm font-bold">{lang === 'ar' ? 'أصدقاء مقترحون' : 'People You May Know'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {friendsData.suggestions.map((s) => (
                <div key={s.id} className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3">
                  <button onClick={() => onOpenProfile(s.id)} className="flex items-center gap-3 text-start">
                    <UserAvatar src={s.avatarUrl} name={s.displayName} size="sm" isOnline={s.isOnline} />
                    <div>
                      <div className="text-sm font-bold">{s.displayName}</div>
                      <div className="text-xs text-zinc-500">@{s.username}</div>
                    </div>
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onOpenChat(s.id)}
                      className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> {lang === 'ar' ? 'مراسلة' : 'Chat'}
                    </button>
                    <button
                      onClick={() =>
                        void apiFetch('/api/community/friends/request', {
                          method: 'POST',
                          body: JSON.stringify({ receiverId: s.id }),
                        })
                          .then(() => {
                            notifyToast(lang === 'ar' ? 'تم إرسال طلب الصداقة' : 'Friend request sent', 'success');
                            void loadSection();
                          })
                          .catch((err: any) => notifyToast(err?.message || 'Failed to send request', 'error'))
                      }
                      className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-semibold inline-flex items-center justify-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> {lang === 'ar' ? 'إضافة' : 'Add'}
                    </button>
                    <button
                      onClick={() =>
                        void apiFetch(`/api/community/follow/${s.id}`, { method: 'POST' })
                          .then(() =>
                            notifyToast(lang === 'ar' ? 'تم تحديث المتابعة' : 'Follow updated', 'success')
                          )
                          .catch((err: any) => notifyToast(err?.message || 'Follow failed', 'error'))
                      }
                      className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs"
                    >
                      {lang === 'ar' ? 'متابعة' : 'Follow'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (section === 'groups') {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-bold">TIGER GROUPS</h2>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> {lang === 'ar' ? 'إنشاء مجموعة' : 'Create Group'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">{g.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-0.5 tabular-nums">
                    {g.privacy === 'private' ? <Lock className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                    <span>{g.privacy === 'private' ? (lang === 'ar' ? 'خاصة' : 'Private') : lang === 'ar' ? 'عامة' : 'Public'}</span>
                    <span>·</span>
                    <Users className="w-3.5 h-3.5" />
                    <span>{g.membersCount}</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() =>
                      void apiFetch(`/api/community/groups/${g.id}/join`, { method: 'POST' })
                        .then(() => loadSection())
                        .catch((err: any) => notifyToast(err?.message || 'Failed to update membership', 'error'))
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      g.myMembership
                        ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
                        : 'bg-orange-500 text-white'
                    }`}
                  >
                    {g.myMembership
                      ? g.myMembership.status === 'pending'
                        ? lang === 'ar'
                          ? 'قيد الانتظار'
                          : 'Pending'
                        : lang === 'ar'
                        ? 'مغادرة'
                        : 'Joined'
                      : lang === 'ar'
                      ? 'انضمام'
                      : 'Join'}
                  </button>
                  {(g.myMembership?.role === 'admin' || g.myMembership?.role === 'moderator') && (
                    <button
                      onClick={() => void openGroupMembers(g.id)}
                      className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs"
                    >
                      {lang === 'ar' ? 'الأعضاء' : 'Manage'}
                    </button>
                  )}
                </div>
              </div>
              {g.description && <p className="text-xs text-zinc-600 dark:text-zinc-400">{g.description}</p>}
            </div>
          ))}
        </div>

        {showCreateGroup && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">{lang === 'ar' ? 'إنشاء مجموعة جديدة' : 'Create Group'}</h3>
                <button onClick={() => setShowCreateGroup(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={lang === 'ar' ? 'اسم المجموعة' : 'Group Name'}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
              />
              <textarea
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                rows={3}
                placeholder={lang === 'ar' ? 'وصف المجموعة' : 'Description'}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
              />
              <select
                value={groupPrivacy}
                onChange={(e) => setGroupPrivacy(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"
              >
                <option value="public">{lang === 'ar' ? 'عامة' : 'Public'}</option>
                <option value="private">{lang === 'ar' ? 'خاصة (تتطلب موافقة)' : 'Private (Approval Required)'}</option>
              </select>
              <button
                onClick={async () => {
                  const trimmedName = groupName.trim();
                  if (!trimmedName) {
                    notifyToast(lang === 'ar' ? 'أدخل اسم المجموعة' : 'Enter group name', 'error');
                    return;
                  }
                  try {
                    await apiFetch('/api/community/groups', {
                      method: 'POST',
                      body: JSON.stringify({ name: trimmedName, description: groupDesc, privacy: groupPrivacy }),
                    });
                    setShowCreateGroup(false);
                    setGroupName('');
                    setGroupDesc('');
                    await loadSection();
                  } catch (err: any) {
                    notifyToast(err?.message || 'Failed to create group', 'error');
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-orange-500 text-sm font-semibold"
              >
                {lang === 'ar' ? 'إنشاء' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {manageGroupId && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">{lang === 'ar' ? 'إدارة أعضاء المجموعة' : 'Group Members'}</h3>
                <button onClick={() => setManageGroupId(null)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {groupMembers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 text-xs">
                    <div>
                      <div className="font-bold">{m.user?.displayName}</div>
                      <div className="text-zinc-500">
                        {m.role} · {m.status}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {m.status === 'pending' && (
                        <button
                          onClick={() =>
                            void apiFetch(`/api/community/groups/${manageGroupId}/members/${m.userId}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'active' }),
                            })
                              .then(() => openGroupMembers(manageGroupId))
                              .catch((err: any) => notifyToast(err?.message || 'Update failed', 'error'))
                          }
                          className="p-1.5 rounded bg-emerald-600 text-white"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {m.role === 'member' && (
                        <button
                          onClick={() =>
                            void apiFetch(`/api/community/groups/${manageGroupId}/members/${m.userId}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ role: 'moderator' }),
                            })
                              .then(() => openGroupMembers(manageGroupId))
                              .catch((err: any) => notifyToast(err?.message || 'Update failed', 'error'))
                          }
                          className="px-2 py-1 rounded bg-orange-500 text-white"
                        >
                          {lang === 'ar' ? 'تعيين مشرف' : 'Make Mod'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // PAGES
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold">TIGER PAGES</h2>
        <button
          onClick={() => setShowCreatePage(true)}
          className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> {lang === 'ar' ? 'إنشاء صفحة' : 'Create Page'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pages.map((p) => (
          <div key={p.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">{p.name}</h3>
                <div className="text-xs text-zinc-500 tabular-nums">
                  {p.category} · {p.isBusiness ? (lang === 'ar' ? 'تجارية' : 'Business') : lang === 'ar' ? 'شخصية' : 'Personal'} ·{' '}
                  {p.followersCount} {lang === 'ar' ? 'متابع' : 'followers'}
                </div>
              </div>
              <button
                onClick={() =>
                  void apiFetch(`/api/community/pages/${p.id}/follow`, { method: 'POST' })
                    .then(() => loadSection())
                    .catch((err: any) => notifyToast(err?.message || 'Follow failed', 'error'))
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  p.isFollowing ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-orange-500 text-white'
                }`}
              >
                {p.isFollowing ? (lang === 'ar' ? 'متابَع' : 'Following') : lang === 'ar' ? 'متابعة' : 'Follow'}
              </button>
            </div>
            {p.description && <p className="text-xs text-zinc-600 dark:text-zinc-400">{p.description}</p>}

            {p.myRole === 'owner' || p.myRole === 'admin' ? (
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
                <input
                  value={pagePostText[p.id] || ''}
                  onChange={(e) => setPagePostText((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={lang === 'ar' ? 'انشر باسم الصفحة...' : 'Post as this page...'}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                />
                <button
                  onClick={async () => {
                    const txt = (pagePostText[p.id] || '').trim();
                    if (!txt) return;
                    try {
                      await apiFetch('/api/social/posts', {
                        method: 'POST',
                        body: JSON.stringify({ content: txt, pageId: p.id }),
                      });
                      setPagePostText((prev) => ({ ...prev, [p.id]: '' }));
                      notifyToast(lang === 'ar' ? 'تم النشر باسم الصفحة' : 'Published on page', 'success');
                    } catch (err: any) {
                      notifyToast(err?.message || 'Failed to publish post', 'error');
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold"
                >
                  {lang === 'ar' ? 'نشر' : 'Post'}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {showCreatePage && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{lang === 'ar' ? 'إنشاء صفحة جديدة' : 'Create Page'}</h3>
              <button onClick={() => setShowCreatePage(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              placeholder={lang === 'ar' ? 'اسم الصفحة' : 'Page Name'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <input
              value={pageCat}
              onChange={(e) => setPageCat(e.target.value)}
              placeholder={lang === 'ar' ? 'التصنيف (تقنية، متجر، تعليم...)' : 'Category'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <textarea
              value={pageDesc}
              onChange={(e) => setPageDesc(e.target.value)}
              rows={3}
              placeholder={lang === 'ar' ? 'وصف الصفحة' : 'Description'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={pageBusiness} onChange={(e) => setPageBusiness(e.target.checked)} />
              <span>{lang === 'ar' ? 'صفحة تجارية / أعمال' : 'Business Page'}</span>
            </label>
            <button
              onClick={async () => {
                const trimmedName = pageName.trim();
                if (!trimmedName) {
                  notifyToast(lang === 'ar' ? 'أدخل اسم الصفحة' : 'Enter page name', 'error');
                  return;
                }
                try {
                  await apiFetch('/api/community/pages', {
                    method: 'POST',
                    body: JSON.stringify({ name: trimmedName, category: pageCat, description: pageDesc, isBusiness: pageBusiness }),
                  });
                  setShowCreatePage(false);
                  setPageName('');
                  setPageDesc('');
                  await loadSection();
                } catch (err: any) {
                  notifyToast(err?.message || 'Failed to create page', 'error');
                }
              }}
              className="w-full py-2.5 rounded-xl bg-orange-500 text-sm font-semibold"
            >
              {lang === 'ar' ? 'إنشاء الصفحة' : 'Create Page'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
