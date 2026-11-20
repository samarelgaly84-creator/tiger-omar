import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera,
  Calendar,
  MapPin,
  Briefcase,
  Globe,
  MessageSquare,
  Edit3,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { TIGER_DEFAULT_COVER, UserAvatar } from '../BrandMark';
import { LoadingSkeleton } from '../ErrorBoundary';

export const ProfileView: React.FC<{
  targetUserId?: number | null;
  onOpenChat: (userId: number) => void;
}> = ({ targetUserId, onOpenChat }) => {
  const { user: currentUser, lang, notifyToast, refreshUser } = useAuth();
  const uid = targetUserId || currentUser?.id;
  const isSelf = uid === currentUser?.id;

  const [data, setData] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [tab, setTab] = useState<'posts' | 'photos' | 'videos'>('posts');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [workInput, setWorkInput] = useState('');

  const loadProfile = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const [pRes, feedRes] = await Promise.all([
        apiFetch(`/api/community/users/${uid}`),
        apiFetch(`/api/social/feed?authorId=${uid}`),
      ]);
      setData(pRes);
      setUserPosts(feedRes.posts || []);
      setNameInput(pRes.user.displayName || '');
      setBioInput(pRes.user.bio || '');
      setLocationInput(pRes.profile?.location || '');
      setWorkInput(pRes.profile?.workplace || '');
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load profile', 'error');
    } finally {
      setLoading(false);
    }
  }, [uid, notifyToast]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const uploadImage = async (kind: 'avatar' | 'cover', file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      await apiFetch('/api/auth/avatar', { method: 'POST', body: fd });
      await loadProfile();
      await refreshUser();
      notifyToast(lang === 'ar' ? 'تم تحديث الصورة' : 'Image updated', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Upload failed', 'error');
    }
  };

  if (loading || !data) {
    return (
      <div className="max-w-4xl mx-auto">
        <LoadingSkeleton rows={3} />
      </div>
    );
  }

  const profileUser = data.user;
  const profileDetails = data.profile;
  const stats = data.stats;

  const photos = userPosts.flatMap((p) => (p.media || []).filter((m: any) => m.mediaType === 'image'));
  const videos = userPosts.flatMap((p) => (p.media || []).filter((m: any) => m.mediaType === 'video'));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Cover + Avatar Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="relative h-52 bg-zinc-950">
          <img
            src={profileUser.coverUrl || TIGER_DEFAULT_COVER}
            alt="Cover"
            className="w-full h-full object-cover"
          />
          {isSelf && (
            <label className="absolute bottom-3 end-3 px-3 py-1.5 rounded-xl bg-black/70 text-white text-xs cursor-pointer inline-flex items-center gap-1.5 hover:bg-black">
              <Camera className="w-3.5 h-3.5" /> {lang === 'ar' ? 'تغيير الغلاف' : 'Edit Cover'}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && void uploadImage('cover', e.target.files[0])}
                className="hidden"
              />
            </label>
          )}
        </div>

        <div className="px-6 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4 -mt-12 mb-4">
            <div className="relative">
              <UserAvatar src={profileUser.avatarUrl} name={profileUser.displayName} size="xl" isOnline={profileUser.isOnline} />
              {isSelf && (
                <label className="absolute bottom-0 end-0 p-2 rounded-full bg-orange-500 text-white cursor-pointer shadow-lg">
                  <Camera className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && void uploadImage('avatar', e.target.files[0])}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <div className="flex gap-2">
              {isSelf ? (
                <button
                  onClick={() => setEditing((e) => !e)}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" /> {lang === 'ar' ? 'تعديل الملف' : 'Edit Profile'}
                </button>
              ) : (
                <button
                  onClick={() => onOpenChat(profileUser.id)}
                  className="px-4 py-2 rounded-xl bg-orange-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> {lang === 'ar' ? 'مراسلة' : 'Message'}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-display font-bold">{profileUser.displayName}</h2>
              {profileUser.isVerified && <CheckCircle2 className="w-4 h-4 text-orange-500" />}
            </div>
            <div className="text-xs text-zinc-500">@{profileUser.username}</div>
            {profileUser.bio && <p className="text-sm text-zinc-700 dark:text-zinc-300">{profileUser.bio}</p>}

            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 pt-2 tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> {new Date(profileUser.createdAt).toLocaleDateString()}
              </span>
              {profileDetails?.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {profileDetails.location}
                </span>
              )}
              {profileDetails?.workplace && (
                <span className="inline-flex items-center gap-1">
                  <Briefcase className="w-3.5 h-3.5" /> {profileDetails.workplace}
                </span>
              )}
              {profileDetails?.website && (
                <span className="inline-flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" /> {profileDetails.website}
                </span>
              )}
            </div>

            <div className="flex items-center gap-5 pt-2 text-xs font-semibold tabular-nums">
              <span>
                {stats.friendsCount} <span className="text-zinc-500 font-normal">{lang === 'ar' ? 'أصدقاء' : 'Friends'}</span>
              </span>
              <span>
                {stats.followersCount} <span className="text-zinc-500 font-normal">{lang === 'ar' ? 'متابعون' : 'Followers'}</span>
              </span>
              <span>
                {stats.followingCount} <span className="text-zinc-500 font-normal">{lang === 'ar' ? 'يتابع' : 'Following'}</span>
              </span>
            </div>
          </div>

          {editing && (
            <div className="mt-5 pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder={lang === 'ar' ? 'الاسم المعروض' : 'Display Name'}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                />
                <input
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder={lang === 'ar' ? 'المدينة / الدولة' : 'Location'}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                />
                <input
                  value={workInput}
                  onChange={(e) => setWorkInput(e.target.value)}
                  placeholder={lang === 'ar' ? 'العمل' : 'Workplace'}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                />
              </div>
              <textarea
                value={bioInput}
                onChange={(e) => setBioInput(e.target.value)}
                rows={2}
                placeholder={lang === 'ar' ? 'النبذة الشخصية' : 'Bio'}
                className="w-full px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
              />
              <button
                onClick={async () => {
                  try {
                    await apiFetch('/api/auth/profile', {
                      method: 'PATCH',
                      body: JSON.stringify({
                        displayName: nameInput,
                        bio: bioInput,
                        location: locationInput,
                        workplace: workInput,
                      }),
                    });
                    setEditing(false);
                    await loadProfile();
                    await refreshUser();
                    notifyToast(lang === 'ar' ? 'تم حفظ الملف الشخصي' : 'Profile saved', 'success');
                  } catch (err: any) {
                    notifyToast(err?.message || 'Failed to save profile', 'error');
                  }
                }}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-xs font-semibold"
              >
                {lang === 'ar' ? 'حفظ التغييرات' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Profile Content Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-fit">
        {(['posts', 'photos', 'videos'] as const).map((tk) => (
          <button
            key={tk}
            onClick={() => setTab(tk)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${
              tab === tk ? 'bg-orange-500 text-white' : 'text-zinc-500'
            }`}
          >
            {tk === 'posts'
              ? lang === 'ar'
                ? 'المنشورات'
                : 'Posts'
              : tk === 'photos'
              ? lang === 'ar'
                ? 'الصور'
                : 'Photos'
              : lang === 'ar'
              ? 'الفيديوهات'
              : 'Videos'}
          </button>
        ))}
      </div>

      {tab === 'posts' && (
        <div className="space-y-4">
          {userPosts.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center text-sm text-zinc-500">
              {lang === 'ar' ? 'لا توجد منشورات بعد' : 'No posts yet'}
            </div>
          ) : (
            userPosts.map((p) => (
              <div key={p.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-2">
                <div className="text-xs text-zinc-500 tabular-nums">{new Date(p.createdAt).toLocaleString()}</div>
                <p className="text-sm whitespace-pre-wrap">{p.content}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'photos' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.length === 0 ? (
            <div className="col-span-full text-center text-sm text-zinc-500 py-8">
              {lang === 'ar' ? 'لا توجد صور' : 'No photos'}
            </div>
          ) : (
            photos.map((m: any) => (
              <img key={m.id} src={m.url} alt="" className="rounded-xl aspect-square object-cover border border-zinc-800" />
            ))
          )}
        </div>
      )}

      {tab === 'videos' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {videos.length === 0 ? (
            <div className="col-span-full text-center text-sm text-zinc-500 py-8">
              {lang === 'ar' ? 'لا توجد فيديوهات' : 'No videos'}
            </div>
          ) : (
            videos.map((m: any) => <video key={m.id} src={m.url} controls className="rounded-xl w-full" />)
          )}
        </div>
      )}
    </div>
  );
};
