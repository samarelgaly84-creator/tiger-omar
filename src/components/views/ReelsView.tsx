import React, { useState, useEffect, useCallback } from 'react';
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Plus,
  ChevronUp,
  ChevronDown,
  Music,
  Eye,
  X,
  Send,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { UserAvatar } from '../BrandMark';
import { LoadingSkeleton } from '../ErrorBoundary';

interface ReelItem {
  id: number;
  authorId: number;
  videoUrl: string;
  caption: string;
  hashtags: string[];
  musicTitle: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  liked: boolean;
  saved: boolean;
  author: {
    id: number;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isFollowing: boolean;
  } | null;
  comments: Array<{
    id: number;
    content: string;
    author: { displayName: string; avatarUrl: string | null } | null;
  }>;
}

export const ReelsView: React.FC = () => {
  const { lang, notifyToast } = useAuth();
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [musicTitle, setMusicTitle] = useState('Original Audio');
  const [uploading, setUploading] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');

  const loadReels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ reels: ReelItem[] }>('/api/reels');
      setReels(res.reels || []);
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load reels', 'error');
    } finally {
      setLoading(false);
    }
  }, [notifyToast]);

  useEffect(() => {
    void loadReels();
  }, [loadReels]);

  const activeReel = reels[activeIndex] || null;

  useEffect(() => {
    if (activeReel) {
      void apiFetch(`/api/reels/${activeReel.id}/view`, { method: 'POST' }).catch(() => {});
    }
  }, [activeReel?.id]);

  const handleUpload = async () => {
    if (!videoFile) return notifyToast(lang === 'ar' ? 'اختر ملف فيديو' : 'Select a video file', 'error');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('video', videoFile);
      fd.append('caption', caption);
      fd.append('musicTitle', musicTitle);
      await apiFetch('/api/reels', { method: 'POST', body: fd });
      setShowUpload(false);
      setVideoFile(null);
      setCaption('');
      await loadReels();
      setActiveIndex(0);
      notifyToast(lang === 'ar' ? 'تم نشر الفيديو بنجاح' : 'Reel published', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const toggleLike = async (reel: ReelItem) => {
    try {
      const res = await apiFetch<{ liked: boolean }>(`/api/reels/${reel.id}/like`, { method: 'POST' });
      setReels((prev) =>
        prev.map((r) =>
          r.id === reel.id
            ? { ...r, liked: res.liked, likesCount: Math.max(0, r.likesCount + (res.liked ? 1 : -1)) }
            : r
        )
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Action failed', 'error');
    }
  };

  const toggleSave = async (reel: ReelItem) => {
    try {
      const res = await apiFetch<{ saved: boolean }>(`/api/reels/${reel.id}/save`, { method: 'POST' });
      setReels((prev) => prev.map((r) => (r.id === reel.id ? { ...r, saved: res.saved } : r)));
    } catch (err: any) {
      notifyToast(err?.message || 'Save failed', 'error');
    }
  };

  const toggleFollow = async (authorId: number) => {
    try {
      const res = await apiFetch<{ following: boolean }>(`/api/community/follow/${authorId}`, { method: 'POST' });
      setReels((prev) =>
        prev.map((r) =>
          r.author && r.author.id === authorId ? { ...r, author: { ...r.author, isFollowing: res.following } } : r
        )
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Follow failed', 'error');
    }
  };

  const addComment = async () => {
    if (!activeReel || !commentText.trim()) return;
    try {
      const res = await apiFetch<{ comment: any }>(`/api/reels/${activeReel.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setReels((prev) =>
        prev.map((r) =>
          r.id === activeReel.id
            ? { ...r, comments: [res.comment, ...r.comments], commentsCount: r.commentsCount + 1 }
            : r
        )
      );
      setCommentText('');
    } catch (err: any) {
      notifyToast(err?.message || 'Comment failed', 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-zinc-950 dark:text-white">TIGER REELS</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {lang === 'ar' ? 'فيديوهات قصيرة عمودية بتشغيل تلقائي' : 'Vertical short videos with auto-playback'}
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold"
        >
          <Plus className="w-4 h-4" />
          {lang === 'ar' ? 'رفع فيديو' : 'Upload Reel'}
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={2} />
      ) : !activeReel ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {lang === 'ar' ? 'لا توجد فيديوهات Reels بعد. ارفع أول فيديو قصير!' : 'No Reels yet. Upload your first short video!'}
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-xs font-semibold"
          >
            {lang === 'ar' ? 'رفع فيديو الآن' : 'Upload First Reel'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row items-center justify-center gap-6">
          {/* Vertical Reel Player */}
          <div className="relative w-full max-w-[360px] h-[620px] rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-2xl">
            <video
              key={activeReel.id}
              src={activeReel.videoUrl}
              autoPlay
              loop
              playsInline
              controls
              className="w-full h-full object-cover"
            />

            {/* Overlay metadata */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 space-y-2 pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                <UserAvatar src={activeReel.author?.avatarUrl} name={activeReel.author?.displayName || 'U'} size="sm" />
                <span className="text-sm font-bold text-white">@{activeReel.author?.username}</span>
                {activeReel.author && (
                  <button
                    onClick={() => void toggleFollow(activeReel.author!.id)}
                    className="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                  >
                    <UserPlus className="w-3 h-3" />
                    {activeReel.author.isFollowing
                      ? lang === 'ar'
                        ? 'متابَع'
                        : 'Following'
                      : lang === 'ar'
                      ? 'متابعة'
                      : 'Follow'}
                  </button>
                )}
              </div>
              {activeReel.caption && <p className="text-xs text-zinc-100">{activeReel.caption}</p>}
              <div className="flex items-center gap-2 text-[11px] text-orange-300">
                <Music className="w-3.5 h-3.5" />
                <span>{activeReel.musicTitle}</span>
                <span>·</span>
                <Eye className="w-3.5 h-3.5" />
                <span className="tabular-nums">{activeReel.viewsCount}</span>
              </div>
            </div>

            {/* Right-side action rail */}
            <div className="absolute end-3 bottom-24 flex flex-col items-center gap-4 text-white">
              <button onClick={() => void toggleLike(activeReel)} className="flex flex-col items-center gap-1">
                <div className={`p-2.5 rounded-full bg-black/50 ${activeReel.liked ? 'text-orange-500' : ''}`}>
                  <Heart className="w-5 h-5" />
                </div>
                <span className="text-[11px] tabular-nums">{activeReel.likesCount}</span>
              </button>

              <button onClick={() => setShowComments(true)} className="flex flex-col items-center gap-1">
                <div className="p-2.5 rounded-full bg-black/50">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <span className="text-[11px] tabular-nums">{activeReel.commentsCount}</span>
              </button>

              <button onClick={() => void toggleSave(activeReel)} className="flex flex-col items-center gap-1">
                <div className={`p-2.5 rounded-full bg-black/50 ${activeReel.saved ? 'text-orange-500' : ''}`}>
                  <Bookmark className="w-5 h-5" />
                </div>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href);
                  notifyToast(lang === 'ar' ? 'تم نسخ رابط الفيديو' : 'Reel link copied', 'success');
                }}
                className="p-2.5 rounded-full bg-black/50"
              >
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation controls & Comments drawer */}
          <div className="flex md:flex-col gap-3">
            <button
              disabled={activeIndex <= 0}
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-30"
            >
              <ChevronUp className="w-5 h-5" />
            </button>
            <div className="text-center text-xs font-mono tabular-nums text-zinc-500">
              {activeIndex + 1} / {reels.length}
            </div>
            <button
              disabled={activeIndex >= reels.length - 1}
              onClick={() => setActiveIndex((i) => Math.min(reels.length - 1, i + 1))}
              className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-30"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Upload Reel Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{lang === 'ar' ? 'رفع فيديو Reels' : 'Upload Reel'}</h3>
              <button onClick={() => setShowUpload(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-zinc-300"
            />
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder={lang === 'ar' ? 'الوصف والهاشتاج (#tiger #tech)...' : 'Caption & hashtags...'}
              className="w-full rounded-xl p-3 bg-zinc-950 border border-zinc-800 text-sm"
            />
            <input
              value={musicTitle}
              onChange={(e) => setMusicTitle(e.target.value)}
              placeholder={lang === 'ar' ? 'اسم الصوت / الموسيقى' : 'Audio / Music name'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <button
              onClick={() => void handleUpload()}
              disabled={uploading}
              className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
            >
              {uploading ? '...' : lang === 'ar' ? 'نشر الفيديو' : 'Publish Reel'}
            </button>
          </div>
        </div>
      )}

      {/* Comments Modal */}
      {showComments && activeReel && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'التعليقات' : 'Comments'} ({activeReel.commentsCount})
              </h3>
              <button onClick={() => setShowComments(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2.5">
              {activeReel.comments.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-4">
                  {lang === 'ar' ? 'لا توجد تعليقات بعد' : 'No comments yet'}
                </p>
              ) : (
                activeReel.comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-xs">
                    <UserAvatar src={c.author?.avatarUrl} name={c.author?.displayName || 'U'} size="xs" />
                    <div className="bg-zinc-950 rounded-xl px-3 py-2 flex-1">
                      <div className="font-bold">{c.author?.displayName}</div>
                      <p className="text-zinc-300 mt-0.5">{c.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addComment()}
                placeholder={lang === 'ar' ? 'أضف تعليقاً...' : 'Write a comment...'}
                className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"
              />
              <button onClick={() => void addComment()} className="p-2 rounded-xl bg-orange-500 text-white">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
