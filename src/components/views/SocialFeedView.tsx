import React, { useState, useEffect, useCallback } from 'react';
import {
  Image as ImageIcon,
  Video,
  FileText,
  Link2,
  BarChart2,
  MapPin,
  Palette,
  Send,
  Bookmark,
  Share2,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Trash2,
  Edit3,
  Eye,
  Lock,
  Globe,
  Users,
  Flag,
  Copy,
  Plus,
  Sparkles,
  Music,
  X,
  ThumbsUp,
  Heart,
  Laugh,
  Frown,
  Angry,
  Smile,
  LocateFixed,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth, useT } from '../../context/AuthContext';
import { UserAvatar } from '../BrandMark';
import { LoadingSkeleton } from '../ErrorBoundary';
import { acquireCurrentLocationWithAddress } from '../../lib/geolocation';
import { LocationPickerModal, LocationPreviewModal } from '../TigerMapWidget';

interface PostMedia {
  id: number;
  mediaType: string;
  url: string;
  fileName?: string;
}

interface PostComment {
  id: number;
  parentId: number | null;
  content: string;
  imageUrl?: string | null;
  createdAt: string;
  author: {
    id: number;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isVerified?: boolean;
  } | null;
}

interface PostItem {
  id: number;
  authorId: number;
  content: string;
  postType: string;
  backgroundStyle?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
  location?: string | null;
  locationData?: { lat: number; lng: number; label: string } | null;
  hashtags: string[];
  pollOptions?: Array<{ id: string; text: string; voterIds: number[] }> | null;
  privacy: string;
  isPinned: boolean;
  commentsDisabled: boolean;
  isDraft: boolean;
  viewsCount: number;
  createdAt: string;
  author: {
    id: number;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isVerified?: boolean;
  } | null;
  page?: { id: number; name: string } | null;
  group?: { id: number; name: string } | null;
  media: PostMedia[];
  reactionCounts: Record<string, number>;
  totalReactions: number;
  myReaction: string | null;
  comments: PostComment[];
  commentsCount: number;
  sharesCount: number;
  isSaved: boolean;
}

interface StoryItem {
  id: number;
  authorId: number;
  mediaUrl: string | null;
  mediaType: string;
  textOverlay: string;
  backgroundColor: string;
  stickers: Array<{ id: string; label: string; x: number; y: number }>;
  musicTitle: string | null;
  privacy: string;
  isHighlighted: boolean;
  expiresAt: string;
  viewsCount: number;
  viewers: Array<{ viewerId: number; displayName: string; avatarUrl: string | null; replyText: string | null }>;
  author: { id: number; username: string; displayName: string; avatarUrl: string | null } | null;
}

const REACTIONS = [
  { key: 'like', labelAr: 'إعجاب', labelEn: 'Like', icon: ThumbsUp, color: 'text-orange-500' },
  { key: 'love', labelAr: 'أحببته', labelEn: 'Love', icon: Heart, color: 'text-rose-500' },
  { key: 'haha', labelAr: 'مضحك', labelEn: 'Haha', icon: Laugh, color: 'text-amber-400' },
  { key: 'wow', labelAr: 'مدهش', labelEn: 'Wow', icon: Sparkles, color: 'text-yellow-400' },
  { key: 'sad', labelAr: 'حزين', labelEn: 'Sad', icon: Frown, color: 'text-sky-400' },
  { key: 'angry', labelAr: 'غاضب', labelEn: 'Angry', icon: Angry, color: 'text-red-500' },
];

const COLOR_BACKGROUNDS = [
  '',
  'bg-gradient-to-br from-zinc-950 via-zinc-900 to-orange-950 text-white',
  'bg-gradient-to-br from-orange-600 to-amber-500 text-white',
  'bg-gradient-to-br from-zinc-900 to-black text-orange-400 border border-orange-500/30',
];

const LICENSED_MUSIC = [
  'TIGER Pulse — Cinematic Beats',
  'Desert Horizon — Ambient Lo-Fi',
  'Obsidian Drive — Electronic',
  'Golden Amber — Acoustic',
];

interface MatchedAccount {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  isOnline: boolean;
}

export const SocialFeedView: React.FC<{
  searchQuery?: string;
  onOpenProfile?: (userId: number) => void;
  onOpenChat?: (userId: number) => void;
}> = ({ searchQuery = '', onOpenProfile, onOpenChat }) => {
  const { user, lang, notifyToast } = useAuth();
  const t = useT();

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [matchedUsers, setMatchedUsers] = useState<MatchedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('latest');
  const [sort, setSort] = useState<'latest' | 'relevant'>('latest');

  // Composer state
  const [content, setContent] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'friends' | 'private'>('public');
  const [location, setLocation] = useState('');
  const [locationData, setLocationData] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [showLocation, setShowLocation] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [locatingPost, setLocatingPost] = useState(false);
  const [previewPostLoc, setPreviewPostLoc] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [bgStyle, setBgStyle] = useState('');
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [uploadedMedia, setUploadedMedia] = useState<
    Array<{ url: string; mediaType: string; fileName: string; mimeType: string; fileSize: number }>
  >([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Story modals
  const [showStoryCreator, setShowStoryCreator] = useState(false);
  const [storyText, setStoryText] = useState('');
  const [storyBg, setStoryBg] = useState('#18181b');
  const [storyMusic, setStoryMusic] = useState('');
  const [storySticker, setStorySticker] = useState('');
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [activeStory, setActiveStory] = useState<StoryItem | null>(null);
  const [storyReply, setStoryReply] = useState('');

  // Post interactions state
  const [openCommentsPostId, setOpenCommentsPostId] = useState<number | null>(null);
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const [replyParentMap, setReplyParentMap] = useState<Record<number, number | null>>({});
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editPostContent, setEditPostContent] = useState('');
  const [menuPostId, setMenuPostId] = useState<number | null>(null);
  const [reactionPickerPostId, setReactionPickerPostId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const trimmedQ = searchQuery.trim();
    try {
      const [feedRes, storiesRes, usersRes] = await Promise.all([
        apiFetch<{ posts: PostItem[] }>(
          `/api/social/feed?filter=${encodeURIComponent(filter)}&sort=${sort}&q=${encodeURIComponent(searchQuery)}`
        ),
        apiFetch<{ stories: StoryItem[] }>('/api/stories'),
        trimmedQ
          ? apiFetch<{ users: MatchedAccount[] }>(
              `/api/community/users/search?q=${encodeURIComponent(trimmedQ)}`
            ).catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] }),
      ]);
      setPosts(feedRes.posts || []);
      setStories(storiesRes.stories || []);
      setMatchedUsers(usersRes.users || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load feed');
    } finally {
      setLoading(false);
    }
  }, [filter, sort, searchQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingMedia(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const res = await apiFetch<{ media: any[] }>('/api/social/upload-media', {
        method: 'POST',
        body: fd,
      });
      setUploadedMedia((prev) => [...prev, ...(res.media || [])]);
    } catch (err: any) {
      notifyToast(err?.message || 'Upload failed', 'error');
    } finally {
      e.target.value = '';
      setUploadingMedia(false);
    }
  };

  const handlePublish = async (asDraft = false) => {
    if (!content.trim() && uploadedMedia.length === 0 && !showPoll && !linkUrl.trim()) {
      notifyToast(lang === 'ar' ? 'اكتب محتوى أو أضف وسائط قبل النشر' : 'Add content or media first', 'error');
      return;
    }
    setPublishing(true);
    try {
      let postType = 'text';
      if (showPoll && pollOptions.filter((o) => o.trim()).length >= 2) postType = 'poll';
      else if (uploadedMedia.length > 1) postType = 'carousel';
      else if (uploadedMedia.length === 1) postType = uploadedMedia[0].mediaType;
      else if (linkUrl.trim()) postType = 'link';
      else if (bgStyle) postType = 'colored';

      const res = await apiFetch<{ post: PostItem }>('/api/social/posts', {
        method: 'POST',
        body: JSON.stringify({
          content,
          postType,
          backgroundStyle: bgStyle || null,
          linkUrl: linkUrl.trim() || null,
          location: location.trim() || null,
          locationData: locationData || null,
          pollOptions: showPoll ? pollOptions : null,
          privacy,
          isDraft: asDraft,
          media: uploadedMedia,
        }),
      });

      if (!asDraft && filter !== 'drafts') {
        setPosts((prev) => [res.post, ...prev]);
      }
      setContent('');
      setUploadedMedia([]);
      setLocation('');
      setLocationData(null);
      setLinkUrl('');
      setBgStyle('');
      setShowPoll(false);
      setShowLink(false);
      setShowLocation(false);
      setPreviewMode(false);
      setPollOptions(['', '']);
      notifyToast(
        asDraft
          ? lang === 'ar'
            ? 'تم حفظ المسودة'
            : 'Saved as draft'
          : lang === 'ar'
          ? 'تم نشر المنشور بنجاح'
          : 'Post published',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Publish failed', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleReact = async (postId: number, reactionType: string) => {
    setReactionPickerPostId(null);
    try {
      await apiFetch(`/api/social/posts/${postId}/react`, {
        method: 'POST',
        body: JSON.stringify({ reactionType }),
      });
      await loadData();
    } catch (err: any) {
      notifyToast(err?.message || 'Reaction failed', 'error');
    }
  };

  const handlePollVote = async (postId: number, optionId: string) => {
    try {
      const res = await apiFetch<{ pollOptions: any[] }>(`/api/social/posts/${postId}/poll-vote`, {
        method: 'POST',
        body: JSON.stringify({ optionId }),
      });
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, pollOptions: res.pollOptions } : p)));
    } catch (err: any) {
      notifyToast(err?.message || 'Vote failed', 'error');
    }
  };

  const handleAddComment = async (postId: number) => {
    const text = (commentInputs[postId] || '').trim();
    if (!text) return;
    try {
      const res = await apiFetch<{ comment: PostComment }>(`/api/social/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: text, parentId: replyParentMap[postId] || null }),
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, comments: [...p.comments, res.comment], commentsCount: p.commentsCount + 1 }
            : p
        )
      );
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
      setReplyParentMap((prev) => ({ ...prev, [postId]: null }));
    } catch (err: any) {
      notifyToast(err?.message || 'Comment failed', 'error');
    }
  };

  const handleSavePost = async (postId: number) => {
    try {
      const res = await apiFetch<{ saved: boolean }>(`/api/social/posts/${postId}/save`, { method: 'POST' });
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, isSaved: res.saved } : p)));
      notifyToast(res.saved ? (lang === 'ar' ? 'تم الحفظ' : 'Saved') : lang === 'ar' ? 'تمت الإزالة' : 'Unsaved', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Save failed', 'error');
    }
  };

  const handleSharePost = async (postId: number) => {
    try {
      await apiFetch(`/api/social/posts/${postId}/share`, { method: 'POST', body: JSON.stringify({}) });
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, sharesCount: p.sharesCount + 1 } : p)));
      notifyToast(lang === 'ar' ? 'تمت مشاركة المنشور' : 'Post shared', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Share failed', 'error');
    }
  };

  const handleUpdatePost = async (postId: number, patch: Record<string, unknown>) => {
    setMenuPostId(null);
    try {
      const res = await apiFetch<{ post: PostItem }>(`/api/social/posts/${postId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setPosts((prev) => prev.map((p) => (p.id === postId ? res.post : p)));
      setEditingPostId(null);
      notifyToast(lang === 'ar' ? 'تم التحديث' : 'Updated', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Update failed', 'error');
    }
  };

  const handleDeletePost = async (postId: number) => {
    setMenuPostId(null);
    try {
      await apiFetch(`/api/social/posts/${postId}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      notifyToast(lang === 'ar' ? 'تم حذف المنشور' : 'Post deleted', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Delete failed', 'error');
    }
  };

  const handleReportPost = async (postId: number) => {
    setMenuPostId(null);
    try {
      await apiFetch('/api/social/reports', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'post', targetId: postId, reason: 'Inappropriate content' }),
      });
      notifyToast(lang === 'ar' ? 'تم إرسال البلاغ للإدارة' : 'Report submitted', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Report failed', 'error');
    }
  };

  const handlePublishStory = async () => {
    try {
      const fd = new FormData();
      if (storyFile) fd.append('media', storyFile);
      fd.append('textOverlay', storyText);
      fd.append('backgroundColor', storyBg);
      if (storyMusic) fd.append('musicTitle', storyMusic);
      if (storySticker) {
        fd.append('stickers', JSON.stringify([{ id: 's1', label: storySticker, x: 50, y: 20 }]));
      }
      await apiFetch('/api/stories', { method: 'POST', body: fd });
      setShowStoryCreator(false);
      setStoryText('');
      setStoryFile(null);
      setStoryMusic('');
      setStorySticker('');
      await loadData();
      notifyToast(lang === 'ar' ? 'تم نشر قصتك لمدة 24 ساعة' : 'Story published for 24h', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Story publish failed', 'error');
    }
  };

  const openStory = async (s: StoryItem) => {
    setActiveStory(s);
    try {
      await apiFetch(`/api/stories/${s.id}/view`, { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // ignore
    }
  };

  const sendStoryReply = async () => {
    if (!activeStory || !storyReply.trim()) return;
    try {
      await apiFetch(`/api/stories/${activeStory.id}/view`, {
        method: 'POST',
        body: JSON.stringify({ replyText: storyReply.trim() }),
      });
      setStoryReply('');
      notifyToast(lang === 'ar' ? 'تم إرسال الرد' : 'Reply sent', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Reply failed', 'error');
    }
  };

  const filterTabs = [
    { key: 'latest', label: t.social.allFeed },
    { key: 'friends', label: t.social.friendsFeed },
    { key: 'trending', label: t.social.trendingFeed },
    { key: 'pages', label: t.social.pagesFeed },
    { key: 'groups', label: t.social.groupsFeed },
    { key: 'saved', label: t.social.savedFeed },
    { key: 'drafts', label: t.social.draftsFeed },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* TIGER STORIES STRIP */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{t.social.storiesTitle}</h2>
          <button
            onClick={() => setShowStoryCreator(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-500 hover:text-orange-400"
          >
            <Plus className="w-4 h-4" />
            {t.social.addStory}
          </button>
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          <button
            onClick={() => setShowStoryCreator(true)}
            className="w-24 h-36 rounded-xl border border-dashed border-orange-500/50 bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center gap-2 shrink-0 hover:bg-orange-500/5 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 px-1 truncate max-w-full">
              {t.social.addStory}
            </span>
          </button>

          {stories.map((s) => (
            <button
              key={s.id}
              onClick={() => void openStory(s)}
              className="relative w-24 h-36 rounded-xl overflow-hidden border-2 border-orange-500 shrink-0 group text-start"
              style={{ backgroundColor: s.backgroundColor || '#18181b' }}
            >
              {s.mediaUrl && s.mediaType === 'image' && (
                <img
                  src={s.mediaUrl}
                  alt={s.textOverlay || 'Story'}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-2 flex flex-col justify-between">
                <UserAvatar src={s.author?.avatarUrl} name={s.author?.displayName || 'U'} size="xs" />
                <div>
                  {s.textOverlay && <p className="text-[11px] text-white line-clamp-2 font-medium">{s.textOverlay}</p>}
                  <span className="text-[10px] text-zinc-300 truncate block">{s.author?.displayName}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* POST COMPOSER */}
      {user && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
          <div className="flex items-start gap-3">
            <UserAvatar src={user.avatarUrl} name={user.displayName} size="md" />
            <div className="flex-1 space-y-3">
              {previewMode ? (
                <div className={`rounded-xl p-5 min-h-[100px] border border-zinc-200 dark:border-zinc-800 ${bgStyle}`}>
                  <p className="whitespace-pre-wrap text-sm">{content || '...'}</p>
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={3}
                  placeholder={t.social.createPost}
                  className={`w-full rounded-xl p-3 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500 resize-none ${bgStyle}`}
                />
              )}

              {/* Uploaded media preview */}
              {uploadedMedia.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {uploadedMedia.map((m, idx) => (
                    <div
                      key={idx}
                      className="relative rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 aspect-video flex items-center justify-center"
                    >
                      {m.mediaType === 'image' ? (
                        <img src={m.url} alt={m.fileName} className="w-full h-full object-cover" />
                      ) : m.mediaType === 'video' ? (
                        <video src={m.url} className="w-full h-full object-cover" controls />
                      ) : (
                        <div className="p-2 text-center text-xs text-zinc-300 truncate max-w-full">
                          <FileText className="w-6 h-6 mx-auto mb-1 text-orange-500" />
                          {m.fileName}
                        </div>
                      )}
                      <button
                        onClick={() => setUploadedMedia((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1.5 end-1.5 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Optional fields */}
              {showLocation && (
                <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value);
                        if (!e.target.value.trim()) setLocationData(null);
                      }}
                      placeholder={lang === 'ar' ? 'أضف الموقع الجغرافي أو اختره من الخريطة...' : 'Add location or pick from map...'}
                      className="flex-1 min-w-[180px] px-3 py-2 rounded-lg text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
                    />
                    <button
                      type="button"
                      disabled={locatingPost}
                      onClick={async () => {
                        setLocatingPost(true);
                        try {
                          const fix = await acquireCurrentLocationWithAddress(lang);
                          setLocation(fix.label);
                          setLocationData({ lat: fix.lat, lng: fix.lng, label: fix.label });
                        } catch (err: any) {
                          notifyToast(err?.message || 'Location denied', 'error');
                        } finally {
                          setLocatingPost(false);
                        }
                      }}
                      className="px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      {locatingPost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
                      <span>{lang === 'ar' ? 'موقعي الحالي' : 'My Location'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMapPicker(true)}
                      className="px-3 py-2 rounded-lg border border-orange-500/40 text-orange-500 hover:bg-orange-500/10 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'اختر من الخريطة' : 'Pick on Map'}</span>
                    </button>
                  </div>
                  {locationData && (
                    <div className="flex items-center justify-between text-[11px] text-emerald-500">
                      <span className="font-mono tabular-nums">
                        ✓ {locationData.label} ({locationData.lat.toFixed(4)}, {locationData.lng.toFixed(4)})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setLocation('');
                          setLocationData(null);
                        }}
                        className="text-zinc-400 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {showLink && (
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
                />
              )}

              {showPoll && (
                <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                  <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {lang === 'ar' ? 'خيارات استطلاع الرأي' : 'Poll Options'}
                  </div>
                  {pollOptions.map((opt, idx) => (
                    <input
                      key={idx}
                      value={opt}
                      onChange={(e) => {
                        const copy = [...pollOptions];
                        copy[idx] = e.target.value;
                        setPollOptions(copy);
                      }}
                      placeholder={`${lang === 'ar' ? 'خيار' : 'Option'} ${idx + 1}`}
                      className="w-full px-3 py-1.5 rounded-lg text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                    />
                  ))}
                  {pollOptions.length < 5 && (
                    <button
                      onClick={() => setPollOptions((prev) => [...prev, ''])}
                      className="text-xs text-orange-500 font-medium"
                    >
                      + {lang === 'ar' ? 'إضافة خيار' : 'Add Option'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-1">
              <label className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-zinc-600 dark:text-zinc-300" title="Media">
                <ImageIcon className="w-4 h-4 text-orange-500" />
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx"
                  onChange={handleMediaSelect}
                  className="hidden"
                />
              </label>
              <button
                onClick={() => setShowPoll((v) => !v)}
                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                title="Poll"
              >
                <BarChart2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowLink((v) => !v)}
                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                title="Link"
              >
                <Link2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowLocation((v) => !v)}
                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                title="Location"
              >
                <MapPin className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setBgStyle((cur) => {
                    const idx = COLOR_BACKGROUNDS.indexOf(cur);
                    return COLOR_BACKGROUNDS[(idx + 1) % COLOR_BACKGROUNDS.length];
                  })
                }
                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                title="Colored Background"
              >
                <Palette className="w-4 h-4" />
              </button>

              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as any)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-0 focus:outline-none"
              >
                <option value="public">{lang === 'ar' ? 'عام' : 'Public'}</option>
                <option value="friends">{lang === 'ar' ? 'الأصدقاء' : 'Friends'}</option>
                <option value="private">{lang === 'ar' ? 'أنا فقط' : 'Only Me'}</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewMode((p) => !p)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {t.social.preview}
              </button>
              <button
                onClick={() => void handlePublish(true)}
                disabled={publishing || uploadingMedia}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:opacity-90"
              >
                {t.social.saveDraft}
              </button>
              <button
                onClick={() => void handlePublish(false)}
                disabled={publishing || uploadingMedia}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
              >
                {uploadingMedia ? '...' : t.social.publish}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* FEED FILTERS & SORT */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                filter === tab.key
                  ? 'bg-orange-500 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'latest' | 'relevant')}
          className="text-xs px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200"
        >
          <option value="latest">{t.social.latest}</option>
          <option value="relevant">{t.social.relevant}</option>
        </select>
      </div>

      {/* MATCHING PEOPLE IN GLOBAL SEARCH */}
      {searchQuery.trim() && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-500">
              {lang === 'ar' ? 'الحسابات المطابقة' : 'Matching Accounts'} ({matchedUsers.length})
            </h3>
          </div>
          {matchedUsers.length === 0 ? (
            <p className="text-xs text-zinc-500">
              {lang === 'ar'
                ? `لا يوجد حساب مطابق لـ "${searchQuery.trim()}". تأكد أن الحساب سجّل الدخول إلى TIGER مرة واحدة على الأقل.`
                : `No account matched "${searchQuery.trim()}". Accounts appear once they sign in to TIGER.`}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {matchedUsers.map((u) => {
                const isSelf = u.id === user?.id;
                return (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800"
                  >
                    <button
                      onClick={() => onOpenProfile?.(u.id)}
                      className="flex items-center gap-2.5 text-start min-w-0"
                    >
                      <UserAvatar src={u.avatarUrl} name={u.displayName} size="sm" isOnline={u.isOnline} />
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">
                          {u.displayName} {isSelf ? (lang === 'ar' ? '(أنت)' : '(You)') : ''}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">@{u.username}</div>
                      </div>
                    </button>
                    {!isSelf && onOpenChat && (
                      <button
                        onClick={() => onOpenChat(u.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>{lang === 'ar' ? 'مراسلة' : 'Chat'}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* FEED LIST */}
      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => void loadData()} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-xs font-semibold">
            {t.common.retry}
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {lang === 'ar' ? 'لا توجد منشورات مطابقة حالياً. كن أول من ينشر!' : 'No posts here yet. Create the first post!'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => {
            const isOwner = user?.id === post.authorId;
            return (
              <article
                key={post.id}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => post.author && onOpenProfile?.(post.author.id)}
                    className="flex items-center gap-3 text-start"
                  >
                    <UserAvatar src={post.author?.avatarUrl} name={post.author?.displayName || 'TIGER'} size="md" />
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-bold text-zinc-950 dark:text-white">
                        <span>{post.page ? post.page.name : post.author?.displayName}</span>
                        {post.isPinned && <Pin className="w-3.5 h-3.5 text-orange-500" />}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        <span>@{post.author?.username}</span>
                        <span>·</span>
                        <span>{new Date(post.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}</span>
                        {post.location && (
                          <>
                            <span>·</span>
                            <span>{post.location}</span>
                          </>
                        )}
                        <span>·</span>
                        {post.privacy === 'public' ? (
                          <Globe className="w-3 h-3" />
                        ) : post.privacy === 'friends' ? (
                          <Users className="w-3 h-3" />
                        ) : (
                          <Lock className="w-3 h-3" />
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="relative">
                    <button
                      onClick={() => setMenuPostId(menuPostId === post.id ? null : post.id)}
                      className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {menuPostId === post.id && (
                      <div className="absolute end-0 mt-1 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl z-20 py-1 text-xs">
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(`${window.location.origin}/?post=${post.id}`);
                            setMenuPostId(null);
                            notifyToast(lang === 'ar' ? 'تم نسخ الرابط' : 'Link copied', 'success');
                          }}
                          className="w-full px-3 py-2 text-start hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2"
                        >
                          <Copy className="w-3.5 h-3.5" /> {t.common.copyLink}
                        </button>
                        {isOwner && (
                          <>
                            <button
                              onClick={() => {
                                setEditingPostId(post.id);
                                setEditPostContent(post.content);
                                setMenuPostId(null);
                              }}
                              className="w-full px-3 py-2 text-start hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2"
                            >
                              <Edit3 className="w-3.5 h-3.5" /> {t.common.edit}
                            </button>
                            <button
                              onClick={() => void handleUpdatePost(post.id, { isPinned: !post.isPinned })}
                              className="w-full px-3 py-2 text-start hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2"
                            >
                              <Pin className="w-3.5 h-3.5" /> {post.isPinned ? 'إلغاء التثبيت' : 'تثبيت المنشور'}
                            </button>
                            <button
                              onClick={() =>
                                void handleUpdatePost(post.id, { commentsDisabled: !post.commentsDisabled })
                              }
                              className="w-full px-3 py-2 text-start hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />{' '}
                              {post.commentsDisabled ? 'تفعيل التعليقات' : 'إيقاف التعليقات'}
                            </button>
                            <button
                              onClick={() => void handleDeletePost(post.id)}
                              className="w-full px-3 py-2 text-start text-red-500 hover:bg-red-500/10 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => void handleReportPost(post.id)}
                          className="w-full px-3 py-2 text-start text-amber-500 hover:bg-amber-500/10 flex items-center gap-2"
                        >
                          <Flag className="w-3.5 h-3.5" /> {t.common.report}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content */}
                {editingPostId === post.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editPostContent}
                      onChange={(e) => setEditPostContent(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl p-3 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleUpdatePost(post.id, { content: editPostContent })}
                        className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold"
                      >
                        {t.common.save}
                      </button>
                      <button
                        onClick={() => setEditingPostId(null)}
                        className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  post.content && (
                    <div
                      className={
                        post.backgroundStyle
                          ? `rounded-xl p-6 text-center text-base font-semibold ${post.backgroundStyle}`
                          : 'text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed'
                      }
                    >
                      {post.content}
                    </div>
                  )
                )}

                {/* Link attachment */}
                {post.linkUrl && (
                  <a
                    href={post.linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 hover:border-orange-500/50 transition-colors text-xs text-orange-500 truncate"
                  >
                    {post.linkUrl}
                  </a>
                )}

                {/* Poll */}
                {post.pollOptions && post.pollOptions.length > 0 && (
                  <div className="space-y-2">
                    {(() => {
                      const totalVotes = post.pollOptions.reduce((s, o) => s + (o.voterIds?.length || 0), 0);
                      return post.pollOptions.map((opt) => {
                        const votes = opt.voterIds?.length || 0;
                        const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                        const voted = user ? opt.voterIds?.includes(user.id) : false;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => void handlePollVote(post.id, opt.id)}
                            className={`relative w-full text-start px-3.5 py-2.5 rounded-xl border text-xs font-medium overflow-hidden transition-colors ${
                              voted
                                ? 'border-orange-500 text-orange-500'
                                : 'border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200'
                            }`}
                          >
                            <div
                              className="absolute inset-y-0 start-0 bg-orange-500/15 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                            <div className="relative flex justify-between items-center">
                              <span>{opt.text}</span>
                              <span className="tabular-nums font-mono">{pct}%</span>
                            </div>
                          </button>
                        );
                      });
                    })()}
                  </div>
                )}

                {/* Media Grid */}
                {post.media.length > 0 && (
                  <div className={`grid gap-2 ${post.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {post.media.map((m) => (
                      <div key={m.id} className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black">
                        {m.mediaType === 'image' ? (
                          <img src={m.url} alt={m.fileName || 'Post media'} className="w-full max-h-[420px] object-cover" />
                        ) : m.mediaType === 'video' ? (
                          <video src={m.url} controls className="w-full max-h-[420px]" />
                        ) : (
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 p-4 bg-zinc-900 text-zinc-100 hover:text-orange-400 text-xs"
                          >
                            <FileText className="w-5 h-5 text-orange-500 shrink-0" />
                            <span className="truncate">{m.fileName || 'Document'}</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Post Location Badge (Clickable to open on Map) */}
                {(post.locationData || post.location) && (
                  <div className="flex items-center">
                    {post.locationData ? (
                      <button
                        type="button"
                        onClick={() => setPreviewPostLoc(post.locationData!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-500 hover:bg-orange-500/20 text-xs font-semibold transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span>{post.locationData.label || post.location}</span>
                      </button>
                    ) : (
                      <a
                        href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(post.location!)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:text-orange-500 text-xs font-medium transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span>{post.location}</span>
                      </a>
                    )}
                  </div>
                )}

                {/* Stats bar */}
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 pt-1 tabular-nums">
                  <span>
                    {post.totalReactions} {lang === 'ar' ? 'تفاعل' : 'reactions'} · {post.commentsCount}{' '}
                    {lang === 'ar' ? 'تعليق' : 'comments'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" /> {post.viewsCount}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="relative flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                  <div className="relative">
                    <button
                      onClick={() =>
                        setReactionPickerPostId(reactionPickerPostId === post.id ? null : post.id)
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium ${
                        post.myReaction ? 'text-orange-500' : 'text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      <ThumbsUp className="w-4 h-4" />
                      <span>
                        {post.myReaction
                          ? REACTIONS.find((r) => r.key === post.myReaction)?.[lang === 'ar' ? 'labelAr' : 'labelEn']
                          : lang === 'ar'
                          ? 'تفاعل'
                          : 'React'}
                      </span>
                    </button>

                    {reactionPickerPostId === post.id && (
                      <div className="absolute bottom-full mb-2 start-0 flex items-center gap-1 p-1.5 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl z-20">
                        {REACTIONS.map((r) => {
                          const Icon = r.icon;
                          return (
                            <button
                              key={r.key}
                              onClick={() => void handleReact(post.id, r.key)}
                              title={lang === 'ar' ? r.labelAr : r.labelEn}
                              className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-transform hover:scale-110"
                            >
                              <Icon className={`w-4 h-4 ${r.color}`} />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() =>
                      setOpenCommentsPostId(openCommentsPostId === post.id ? null : post.id)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-medium"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>{lang === 'ar' ? 'تعليق' : 'Comment'}</span>
                  </button>

                  <button
                    onClick={() => void handleSharePost(post.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-medium"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>{t.common.share}</span>
                  </button>

                  <button
                    onClick={() => void handleSavePost(post.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium ${
                      post.isSaved ? 'text-orange-500' : 'text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    <Bookmark className="w-4 h-4" />
                    <span>{lang === 'ar' ? 'حفظ' : 'Save'}</span>
                  </button>
                </div>

                {/* Comments Drawer */}
                {openCommentsPostId === post.id && (
                  <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                    {post.commentsDisabled ? (
                      <p className="text-xs text-zinc-500">{t.social.commentsDisabled}</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          value={commentInputs[post.id] || ''}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))
                          }
                          onKeyDown={(e) => e.key === 'Enter' && void handleAddComment(post.id)}
                          placeholder={t.social.addComment}
                          className="flex-1 px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
                        />
                        <button
                          onClick={() => void handleAddComment(post.id)}
                          className="p-2 rounded-xl bg-orange-500 text-white hover:bg-orange-600"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    <div className="space-y-2.5 max-h-64 overflow-y-auto">
                      {post.comments.map((c) => (
                        <div
                          key={c.id}
                          className={`flex items-start gap-2.5 text-xs ${c.parentId ? 'ms-6' : ''}`}
                        >
                          <UserAvatar src={c.author?.avatarUrl} name={c.author?.displayName || 'U'} size="xs" />
                          <div className="flex-1 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                            <div className="font-bold text-zinc-900 dark:text-zinc-100">{c.author?.displayName}</div>
                            <p className="text-zinc-700 dark:text-zinc-300 mt-0.5">{c.content}</p>
                            {!post.commentsDisabled && (
                              <button
                                onClick={() => {
                                  setReplyParentMap((prev) => ({ ...prev, [post.id]: c.id }));
                                  setCommentInputs((prev) => ({
                                    ...prev,
                                    [post.id]: `@${c.author?.username || ''} `,
                                  }));
                                }}
                                className="text-[11px] text-orange-500 mt-1"
                              >
                                {lang === 'ar' ? 'رد' : 'Reply'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* STORY CREATOR MODAL */}
      {showStoryCreator && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{t.social.addStory}</h3>
              <button onClick={() => setShowStoryCreator(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="file"
              accept="image/*,video/*"
              onChange={(e) => setStoryFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-zinc-300"
            />
            <input
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
              placeholder={lang === 'ar' ? 'أضف نصاً على القصة...' : 'Add text overlay...'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={storyMusic}
                onChange={(e) => setStoryMusic(e.target.value)}
                className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"
              >
                <option value="">{lang === 'ar' ? 'بدون موسيقى' : 'No Music'}</option>
                {LICENSED_MUSIC.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={storySticker}
                onChange={(e) => setStorySticker(e.target.value)}
                className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"
              >
                <option value="">{lang === 'ar' ? 'بدون ملصق' : 'No Sticker'}</option>
                <option value="🔥">🔥</option>
                <option value="⚡">⚡</option>
                <option value="🐅">🐅 TIGER</option>
                <option value="❤️">❤️</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              {['#18181b', '#c2410c', '#0f172a', '#7c2d12'].map((c) => (
                <button
                  key={c}
                  onClick={() => setStoryBg(c)}
                  className={`w-7 h-7 rounded-full border-2 ${storyBg === c ? 'border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={() => void handlePublishStory()}
              className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
            >
              {t.social.publish}
            </button>
          </div>
        </div>
      )}

      {/* STORY VIEWER MODAL */}
      {activeStory && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div
            className="max-w-sm w-full h-[540px] rounded-2xl overflow-hidden border border-zinc-800 relative flex flex-col justify-between p-4"
            style={{ backgroundColor: activeStory.backgroundColor || '#18181b' }}
          >
            {activeStory.mediaUrl && activeStory.mediaType === 'image' && (
              <img src={activeStory.mediaUrl} alt="Story" className="absolute inset-0 w-full h-full object-cover" />
            )}
            {activeStory.mediaUrl && activeStory.mediaType === 'video' && (
              <video src={activeStory.mediaUrl} autoPlay controls className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="relative z-10 flex items-center justify-between bg-black/40 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <UserAvatar src={activeStory.author?.avatarUrl} name={activeStory.author?.displayName || 'U'} size="xs" />
                <div className="text-xs text-white">
                  <div className="font-bold">{activeStory.author?.displayName}</div>
                  {activeStory.musicTitle && (
                    <div className="flex items-center gap-1 text-[10px] text-orange-300">
                      <Music className="w-3 h-3" /> {activeStory.musicTitle}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setActiveStory(null)} className="text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative z-10 text-center space-y-2">
              {activeStory.stickers?.map((st) => (
                <div key={st.id} className="text-3xl">
                  {st.label}
                </div>
              ))}
              {activeStory.textOverlay && (
                <div className="bg-black/60 text-white px-4 py-2 rounded-xl text-sm font-semibold">
                  {activeStory.textOverlay}
                </div>
              )}
            </div>

            <div className="relative z-10 space-y-2">
              {user?.id === activeStory.authorId && (
                <div className="bg-black/60 rounded-xl px-3 py-2 text-xs text-zinc-200 flex items-center justify-between">
                  <span>
                    {lang === 'ar' ? 'المشاهدات:' : 'Views:'} {activeStory.viewsCount}
                  </span>
                  <button
                    onClick={() =>
                      void apiFetch(`/api/stories/${activeStory.id}/highlight`, { method: 'PATCH' })
                        .then(() =>
                          notifyToast(lang === 'ar' ? 'تم تحديث القصة المميزة' : 'Highlight updated', 'success')
                        )
                        .catch((err: any) => notifyToast(err?.message || 'Highlight update failed', 'error'))
                    }
                    className="text-orange-400 font-semibold"
                  >
                    {lang === 'ar' ? 'تثبيت بالمميزة' : 'Highlight'}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={storyReply}
                  onChange={(e) => setStoryReply(e.target.value)}
                  placeholder={lang === 'ar' ? 'رد على القصة...' : 'Reply to story...'}
                  className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/20 text-xs text-white"
                />
                <button onClick={() => void sendStoryReply()} className="p-2 rounded-xl bg-orange-500 text-white">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMapPicker && (
        <LocationPickerModal
          lang={lang}
          initialLocation={locationData}
          onSelect={(picked) => {
            setLocation(picked.label);
            setLocationData(picked);
            setShowLocation(true);
            setShowMapPicker(false);
          }}
          onClose={() => setShowMapPicker(false)}
        />
      )}

      {previewPostLoc && (
        <LocationPreviewModal
          lat={previewPostLoc.lat}
          lng={previewPostLoc.lng}
          label={previewPostLoc.label}
          lang={lang}
          onClose={() => setPreviewPostLoc(null)}
        />
      )}
    </div>
  );
};
