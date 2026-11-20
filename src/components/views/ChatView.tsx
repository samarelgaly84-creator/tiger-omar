import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  MapPin,
  Phone,
  Video,
  Lock,
  Unlock,
  Search,
  Pin,
  Archive,
  BellOff,
  MoreVertical,
  Reply,
  Forward,
  Edit3,
  Trash2,
  Check,
  CheckCheck,
  PhoneOff,
  Plus,
  X,
  FileText,
  Square,
  Users,
  UserPlus,
  MessageSquare,
  Loader2,
  Radio,
  ExternalLink,
  LocateFixed,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth, useT } from '../../context/AuthContext';
import { UserAvatar } from '../BrandMark';
import { encryptMessageE2EE, decryptMessageE2EE } from '../../lib/crypto';
import { LoadingSkeleton } from '../ErrorBoundary';
import { acquireCurrentLocationWithAddress, buildExternalOsmUrl, GeoFix } from '../../lib/geolocation';
import { LocationPreviewModal, TigerMapCanvas } from '../TigerMapWidget';

interface ChatParticipant {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeenAt: string;
  publicKeyJwk: JsonWebKey | null;
}

interface ChatItem {
  id: number;
  chatType: 'direct' | 'group';
  name: string | null;
  lastMessageAt: string;
  membership: {
    isPinned: boolean;
    isArchived: boolean;
    isMuted: boolean;
  };
  participants: ChatParticipant[];
  lastMessage: any;
}

interface ChatMessage {
  id: number;
  chatId: number;
  senderId: number;
  replyToId: number | null;
  forwardedFromId: number | null;
  content: string;
  messageType: string;
  encryptedPayload?: {
    ciphertext: string;
    iv: string;
    senderKeyFingerprint: string;
    algorithm: string;
  } | null;
  locationData?: {
    lat: number;
    lng: number;
    label: string;
    liveShareId?: number;
    isLive?: boolean;
    expiresAt?: string;
    durationMinutes?: number;
    stopped?: boolean;
  } | null;
  reactions: Record<string, number[]>;
  isEdited: boolean;
  isDeleted: boolean;
  readBy: number[];
  deliveredTo: number[];
  createdAt: string;
  sender: { id: number; displayName: string; username: string; avatarUrl: string | null } | null;
  attachments: Array<{ id: number; fileName: string; mimeType: string; url: string }>;
}

export const ChatView: React.FC<{ initialTargetUserId?: number | null }> = ({ initialTargetUserId }) => {
  const { user, lang, e2eeKeys, notifyToast, sendWs, subscribeWs } = useAuth();
  const t = useT();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [decryptedMap, setDecryptedMap] = useState<Record<number, string>>({});
  const [loadingChats, setLoadingChats] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [msgInput, setMsgInput] = useState('');
  const [useE2EE, setUseE2EE] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<ChatMessage | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);

  // Voice recording
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Account search & direct chat starter
  const [searchedUsers, setSearchedUsers] = useState<ChatParticipant[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [startingChatUserId, setStartingChatUserId] = useState<number | null>(null);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatQuery, setNewChatQuery] = useState('');
  const [newChatUsers, setNewChatUsers] = useState<ChatParticipant[]>([]);
  const [loadingNewChatUsers, setLoadingNewChatUsers] = useState(false);

  // New group modal
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [allUsers, setAllUsers] = useState<ChatParticipant[]>([]);
  const [selectedGroupUsers, setSelectedGroupUsers] = useState<number[]>([]);

  // WebRTC Call state
  const [callState, setCallState] = useState<{
    active: boolean;
    incoming: boolean;
    video: boolean;
    peerId: number;
    peerName: string;
    offer?: any;
  } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Location & Live Location state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locFix, setLocFix] = useState<GeoFix | null>(null);
  const [liveDuration, setLiveDuration] = useState<15 | 60 | 480>(15);
  const [sendingLoc, setSendingLoc] = useState(false);
  const [activeLiveShares, setActiveLiveShares] = useState<
    Array<{ id: number; chatId: number | null; expiresAt: string; label: string }>
  >([]);
  const [liveCoordsMap, setLiveCoordsMap] = useState<
    Record<number, { lat: number; lng: number; label: string; stopped?: boolean }>
  >({});
  const [previewMapLoc, setPreviewMapLoc] = useState<{
    lat: number;
    lng: number;
    label: string;
    isLive?: boolean;
    stopped?: boolean;
  } | null>(null);
  const chatWatchIdRef = useRef<number | null>(null);
  const activeChatShareIdRef = useRef<number | null>(null);

  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await apiFetch<{ chats: ChatItem[] }>('/api/chats');
      const list = res.chats || [];
      setChats(list);
      setSelectedChatId((prev) => prev ?? (list[0]?.id ?? null));
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load chats', 'error');
    } finally {
      setLoadingChats(false);
    }
  }, [notifyToast]);

  const loadActiveLiveShares = useCallback(async () => {
    try {
      const res = await apiFetch<{ myShares: any[]; sharedWithMe: any[] }>('/api/location/live');
      const mine = (res.myShares || []).filter((s) => s.isActive);
      setActiveLiveShares(mine);
      const mapUpdates: Record<number, { lat: number; lng: number; label: string; stopped?: boolean }> = {};
      for (const s of [...mine, ...(res.sharedWithMe || [])]) {
        if (s.lat !== null && s.lng !== null) {
          mapUpdates[s.id] = { lat: s.lat, lng: s.lng, label: s.label || '' };
        }
      }
      setLiveCoordsMap((prev) => ({ ...prev, ...mapUpdates }));
    } catch {
      // Ignore if location API unavailable
    }
  }, []);

  useEffect(() => {
    void loadChats();
    void loadActiveLiveShares();
    return () => {
      if (chatWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(chatWatchIdRef.current);
      }
    };
  }, [loadChats, loadActiveLiveShares]);

  const startDirectChat = useCallback(
    async (targetUserId: number) => {
      try {
        setStartingChatUserId(targetUserId);
        const res = await apiFetch<{ chat: { id: number } }>('/api/chats/direct', {
          method: 'POST',
          body: JSON.stringify({ targetUserId }),
        });
        setShowArchived(false);
        setShowNewChatModal(false);
        setSearchQuery('');
        setSearchedUsers([]);
        setSelectedChatId(res.chat.id);
        await loadChats();
      } catch (err: any) {
        notifyToast(err?.message || (lang === 'ar' ? 'تعذر بدء المحادثة' : 'Failed to start chat'), 'error');
      } finally {
        setStartingChatUserId(null);
      }
    },
    [lang, loadChats, notifyToast]
  );

  useEffect(() => {
    if (initialTargetUserId) {
      void startDirectChat(initialTargetUserId);
    }
  }, [initialTargetUserId, startDirectChat]);

  // Live account search when typing in Chat sidebar
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchedUsers([]);
      setSearchingUsers(false);
      return;
    }

    let cancelled = false;
    setSearchingUsers(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ users: ChatParticipant[] }>(
          `/api/community/users/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!cancelled) {
          setSearchedUsers(res.users || []);
        }
      } catch {
        if (!cancelled) {
          setSearchedUsers([]);
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
  }, [searchQuery]);

  // Live account search inside "New Direct Chat" modal
  useEffect(() => {
    if (!showNewChatModal) return;
    let cancelled = false;
    setLoadingNewChatUsers(true);
    const timer = window.setTimeout(async () => {
      try {
        const qParam = newChatQuery.trim()
          ? `?q=${encodeURIComponent(newChatQuery.trim())}`
          : '';
        const res = await apiFetch<{ users: ChatParticipant[] }>(
          `/api/community/users/search${qParam}`
        );
        if (!cancelled) {
          setNewChatUsers((res.users || []).filter((u) => u.id !== user?.id));
        }
      } catch {
        if (!cancelled) {
          setNewChatUsers([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingNewChatUsers(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showNewChatModal, newChatQuery, user?.id]);

  const activeChat = chats.find((c) => c.id === selectedChatId) || null;
  const peerParticipant =
    activeChat?.chatType === 'direct'
      ? activeChat.participants.find((p) => p.id !== user?.id) || null
      : null;

  const loadMessages = useCallback(async (chatId: number) => {
    try {
      const res = await apiFetch<{ messages: ChatMessage[] }>(`/api/chats/${chatId}/messages`);
      setMessages(res.messages || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load messages', 'error');
    }
  }, [notifyToast]);

  useEffect(() => {
    if (selectedChatId) {
      void loadMessages(selectedChatId);
    }
  }, [selectedChatId, loadMessages]);

  // Decrypt E2EE messages locally in browser
  useEffect(() => {
    if (!e2eeKeys || !peerParticipant?.publicKeyJwk) return;
    let cancelled = false;
    (async () => {
      for (const m of messages) {
        if (m.messageType === 'encrypted' && m.encryptedPayload && !decryptedMap[m.id]) {
          try {
            const plain = await decryptMessageE2EE(
              m.encryptedPayload,
              e2eeKeys.privateKey,
              peerParticipant.publicKeyJwk!
            );
            if (!cancelled) {
              setDecryptedMap((prev) => ({ ...prev, [m.id]: plain }));
            }
          } catch {
            // Unable to decrypt with current peer key
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, e2eeKeys, peerParticipant?.publicKeyJwk, decryptedMap]);

  // WebSocket real-time listeners
  useEffect(() => {
    return subscribeWs(async (event, payload) => {
      if (event === 'chat:message') {
        if (payload.chatId === selectedChatId) {
          setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
        }
        void loadChats();
      } else if (event === 'chat:edit') {
        setMessages((prev) => prev.map((m) => (m.id === payload.id ? { ...m, ...payload } : m)));
      } else if (event === 'chat:delete') {
        setMessages((prev) => prev.map((m) => (m.id === payload.id ? { ...m, isDeleted: true, content: '' } : m)));
      } else if (event === 'chat:reaction') {
        setMessages((prev) => prev.map((m) => (m.id === payload.id ? { ...m, reactions: payload.reactions } : m)));
      } else if (event === 'chat:typing' && payload.chatId === selectedChatId) {
        setTypingUser(payload.isTyping ? payload.displayName : null);
      } else if (event === 'call:invite') {
        setCallState({
          active: true,
          incoming: true,
          video: Boolean(payload.video),
          peerId: payload.fromUserId,
          peerName: payload.fromDisplayName || 'Caller',
          offer: payload.offer,
        });
      } else if (event === 'webrtc:answer' && pcRef.current && payload.answer) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
        } catch {
          // Ignore invalid SDP state
        }
      } else if (event === 'webrtc:ice' && pcRef.current && payload.candidate) {
        try {
          if (pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
          }
        } catch {
          // Ignore stale ICE candidate
        }
      } else if (event === 'call:end' || event === 'call:reject') {
        endLocalCall();
      } else if (event === 'location:live-update' && payload?.id && payload.lat !== null && payload.lng !== null) {
        setLiveCoordsMap((prev) => ({
          ...prev,
          [payload.id]: { lat: payload.lat, lng: payload.lng, label: payload.label || '', stopped: false },
        }));
      } else if (event === 'location:live-stopped' && payload?.id) {
        setLiveCoordsMap((prev) => ({
          ...prev,
          [payload.id]: { ...(prev[payload.id] || { lat: 0, lng: 0, label: '' }), stopped: true },
        }));
        setActiveLiveShares((prev) => prev.filter((s) => s.id !== payload.id));
      }
    });
  }, [subscribeWs, selectedChatId, loadChats]);

  const sendMessage = async (files?: FileList | null, extraLocation?: { lat: number; lng: number; label: string }) => {
    if (!selectedChatId) return;

    if (editingMsg) {
      try {
        await apiFetch(`/api/chats/messages/${editingMsg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ content: msgInput }),
        });
        setEditingMsg(null);
        setMsgInput('');
      } catch (err: any) {
        notifyToast(err?.message || 'Edit failed', 'error');
      }
      return;
    }

    if (!msgInput.trim() && (!files || files.length === 0) && !extraLocation) return;

    try {
      let body: any;
      if (files && files.length > 0) {
        const fd = new FormData();
        Array.from(files).forEach((f) => fd.append('files', f));
        if (msgInput.trim()) fd.append('content', msgInput.trim());
        if (replyTo) fd.append('replyToId', String(replyTo.id));
        body = fd;
      } else if (extraLocation) {
        body = JSON.stringify({
          content: extraLocation.label,
          messageType: 'location',
          locationData: extraLocation,
        });
      } else if (useE2EE && e2eeKeys && peerParticipant?.publicKeyJwk) {
        const enc = await encryptMessageE2EE(
          msgInput.trim(),
          e2eeKeys.privateKey,
          peerParticipant.publicKeyJwk,
          e2eeKeys.fingerprint
        );
        body = JSON.stringify({
          content: '',
          messageType: 'encrypted',
          encryptedPayload: enc,
          replyToId: replyTo?.id || null,
        });
      } else {
        if (useE2EE && (!e2eeKeys || !peerParticipant?.publicKeyJwk)) {
          notifyToast(
            lang === 'ar'
              ? 'الطرف الآخر لم ينشئ مفتاح التشفير بعد؛ تم الإرسال عبر قناة النقل الآمنة.'
              : 'Peer has no published E2EE public key yet; sending over TLS.',
            'info'
          );
        }
        body = JSON.stringify({
          content: msgInput.trim(),
          messageType: 'text',
          replyToId: replyTo?.id || null,
        });
      }

      await apiFetch(`/api/chats/${selectedChatId}/messages`, { method: 'POST', body });
      setMsgInput('');
      setReplyTo(null);
      if (activeChat) {
        sendWs('chat:typing', {
          chatId: selectedChatId,
          targetUserIds: activeChat.participants.map((p) => p.id),
          isTyping: false,
        });
      }
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to send message', 'error');
    }
  };

  const toggleVoiceRecording = async () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (selectedChatId && blob.size > 0) {
          try {
            const fd = new FormData();
            fd.append('files', blob, `voice-${Date.now()}.webm`);
            fd.append('messageType', 'audio');
            fd.append('content', lang === 'ar' ? 'رسالة صوتية' : 'Voice Note');
            await apiFetch(`/api/chats/${selectedChatId}/messages`, { method: 'POST', body: fd });
          } catch (err: any) {
            notifyToast(err?.message || (lang === 'ar' ? 'تعذر إرسال الرسالة الصوتية' : 'Failed to send voice note'), 'error');
          }
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      notifyToast(lang === 'ar' ? 'تعذر الوصول إلى الميكروفون' : 'Microphone access denied', 'error');
    }
  };

  const fetchLocationForModal = async () => {
    setLocLoading(true);
    setLocError(null);
    try {
      const fix = await acquireCurrentLocationWithAddress(lang);
      setLocFix(fix);
    } catch (err: any) {
      setLocError(err?.message || (lang === 'ar' ? 'تعذر الحصول على الموقع' : 'Location unavailable'));
    } finally {
      setLocLoading(false);
    }
  };

  const openShareLocationModal = () => {
    setShowLocationModal(true);
    if (!locFix) {
      void fetchLocationForModal();
    }
  };

  const sendStaticLocationToChat = async () => {
    if (!locFix || !selectedChatId) return;
    setSendingLoc(true);
    try {
      await sendMessage(null, {
        lat: locFix.lat,
        lng: locFix.lng,
        label: locFix.label,
      });
      setShowLocationModal(false);
      notifyToast(lang === 'ar' ? 'تمت مشاركة موقعك في المحادثة' : 'Location shared in chat', 'success');
    } finally {
      setSendingLoc(false);
    }
  };

  const startLiveLocationInChat = async () => {
    if (!locFix || !selectedChatId) return;
    setSendingLoc(true);
    try {
      const res = await apiFetch<{ share: { id: number; chatId: number; expiresAt: string; label: string } }>(
        '/api/location/live/start',
        {
          method: 'POST',
          body: JSON.stringify({
            lat: locFix.lat,
            lng: locFix.lng,
            accuracy: locFix.accuracy,
            label: locFix.label,
            durationMinutes: liveDuration,
            scope: 'chat',
            chatId: selectedChatId,
            sendChatMessage: true,
          }),
        }
      );

      const shareId = res.share.id;
      activeChatShareIdRef.current = shareId;
      setActiveLiveShares((prev) => [res.share, ...prev]);
      setLiveCoordsMap((prev) => ({
        ...prev,
        [shareId]: { lat: locFix.lat, lng: locFix.lng, label: locFix.label, stopped: false },
      }));

      if (navigator.geolocation) {
        if (chatWatchIdRef.current !== null) navigator.geolocation.clearWatch(chatWatchIdRef.current);
        chatWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            if (!activeChatShareIdRef.current) return;
            void apiFetch(`/api/location/live/${activeChatShareIdRef.current}`, {
              method: 'PATCH',
              body: JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              }),
            }).catch(() => {});
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
        );
      }

      setShowLocationModal(false);
      notifyToast(
        lang === 'ar' ? 'تم تفعيل مشاركة الموقع المباشر' : 'Live location sharing started',
        'success'
      );
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to start live location', 'error');
    } finally {
      setSendingLoc(false);
    }
  };

  const stopLiveShareInChat = async (shareId: number) => {
    try {
      if (chatWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(chatWatchIdRef.current);
        chatWatchIdRef.current = null;
      }
      if (activeChatShareIdRef.current === shareId) {
        activeChatShareIdRef.current = null;
      }
      await apiFetch(`/api/location/live/${shareId}/stop`, { method: 'POST', body: JSON.stringify({}) });
      setActiveLiveShares((prev) => prev.filter((s) => s.id !== shareId));
      setLiveCoordsMap((prev) => ({
        ...prev,
        [shareId]: { ...(prev[shareId] || { lat: 0, lng: 0, label: '' }), stopped: true },
      }));
      notifyToast(lang === 'ar' ? 'تم إيقاف مشاركة الموقع المباشر' : 'Live location sharing stopped', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to stop live sharing', 'error');
    }
  };

  // Real WebRTC P2P Call functions
  const startCall = async (video: boolean) => {
    if (!peerParticipant) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      localCallStreamRef.current = stream;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) sendWs('webrtc:ice', { targetUserId: peerParticipant.id, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) remoteVideoRef.current.srcObject = e.streams[0];
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWs('call:invite', { targetUserId: peerParticipant.id, video, offer });
      setCallState({
        active: true,
        incoming: false,
        video,
        peerId: peerParticipant.id,
        peerName: peerParticipant.displayName,
      });
      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);
    } catch {
      notifyToast(lang === 'ar' ? 'تعذر تشغيل الكاميرا/الميكروفون' : 'Media permission failed', 'error');
    }
  };

  const acceptIncomingCall = async () => {
    if (!callState || !callState.offer) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callState.video });
      localCallStreamRef.current = stream;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) sendWs('webrtc:ice', { targetUserId: callState.peerId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) remoteVideoRef.current.srcObject = e.streams[0];
      };
      await pc.setRemoteDescription(new RTCSessionDescription(callState.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWs('webrtc:answer', { targetUserId: callState.peerId, answer });
      setCallState({ ...callState, incoming: false });
      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);
    } catch {
      endLocalCall();
    }
  };

  const endLocalCall = () => {
    localCallStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    setCallState(null);
  };

  const openNewGroupModal = async () => {
    setShowGroupModal(true);
    try {
      const res = await apiFetch<{ users: ChatParticipant[] }>('/api/community/users/search');
      setAllUsers((res.users || []).filter((u) => u.id !== user?.id));
    } catch {
      // ignore
    }
  };

  const createGroupChat = async () => {
    if (!groupName.trim()) return;
    try {
      const res = await apiFetch<{ chat: { id: number } }>('/api/chats/group', {
        method: 'POST',
        body: JSON.stringify({ name: groupName.trim(), memberIds: selectedGroupUsers }),
      });
      setShowGroupModal(false);
      setGroupName('');
      setSelectedGroupUsers([]);
      setSelectedChatId(res.chat.id);
      await loadChats();
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to create group', 'error');
    }
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const handleSearchToken = normalizedSearch.replace(/^@+/, '');

  const filteredChats = chats.filter((c) => {
    if (Boolean(c.membership.isArchived) !== showArchived) return false;
    if (!normalizedSearch) return true;
    if (c.chatType === 'group') {
      return (c.name || '').toLowerCase().includes(normalizedSearch);
    }
    const peer = c.participants.find((p) => p.id !== user?.id);
    const displayMatch = (peer?.displayName || '').toLowerCase().includes(normalizedSearch);
    const usernameMatch = (peer?.username || '').toLowerCase().includes(handleSearchToken);
    return displayMatch || usernameMatch;
  });

  const existingDirectPeerIds = new Set(
    filteredChats
      .filter((c) => c.chatType === 'direct')
      .map((c) => c.participants.find((p) => p.id !== user?.id)?.id)
      .filter((id): id is number => Boolean(id))
  );

  const matchingAccounts = searchedUsers.filter(
    (u) => u.id !== user?.id && !existingDirectPeerIds.has(u.id)
  );
  const selfMatchedInSearch =
    Boolean(normalizedSearch) && searchedUsers.some((u) => u.id === user?.id);

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-140px)] min-h-[520px] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden grid grid-cols-1 md:grid-cols-3">
      {/* Sidebar Conversations */}
      <aside className="border-e border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-bold">{t.chat.title}</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={`p-2 rounded-lg text-xs ${showArchived ? 'bg-orange-500 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                title={lang === 'ar' ? 'المحادثات المؤرشفة' : 'Archived'}
              >
                <Archive className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setNewChatQuery('');
                  setShowNewChatModal(true);
                }}
                className="p-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
                title={lang === 'ar' ? 'محادثة جديدة مع حساب' : 'New Direct Chat'}
              >
                <UserPlus className="w-4 h-4" />
              </button>
              <button
                onClick={() => void openNewGroupModal()}
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title={t.chat.newGroup}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.chat.searchChats}
              className="w-full ps-9 pe-8 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute end-2.5 top-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                title={lang === 'ar' ? 'مسح البحث' : 'Clear search'}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {loadingChats ? (
            <div className="p-4">
              <LoadingSkeleton rows={3} />
            </div>
          ) : (
            <>
              {filteredChats.map((c) => {
                const peer = c.participants.find((p) => p.id !== user?.id);
                const title = c.chatType === 'group' ? c.name || 'Group' : peer?.displayName || 'User';
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedChatId(c.id)}
                    className={`w-full p-3.5 flex items-center gap-3 text-start transition-colors ${
                      selectedChatId === c.id
                        ? 'bg-orange-500/10'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-950/60'
                    }`}
                  >
                    <UserAvatar
                      src={peer?.avatarUrl}
                      name={title}
                      size="md"
                      isOnline={c.chatType === 'direct' ? peer?.isOnline : false}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-bold truncate">{title}</span>
                        <div className="flex items-center gap-1 text-zinc-400">
                          {c.membership.isPinned && <Pin className="w-3 h-3 text-orange-500" />}
                          {c.membership.isMuted && <BellOff className="w-3 h-3" />}
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {c.lastMessage?.messageType === 'encrypted'
                          ? '🔒 Encrypted message'
                          : c.lastMessage?.content || (peer ? `@${peer.username}` : '...')}
                      </p>
                    </div>
                  </button>
                );
              })}

              {/* Account search results when searching */}
              {normalizedSearch && (
                <div className="bg-zinc-50/70 dark:bg-zinc-950/40">
                  <div className="px-4 py-2 text-[11px] font-bold text-orange-500 uppercase tracking-wider flex items-center justify-between">
                    <span>{lang === 'ar' ? 'حسابات على TIGER' : 'Accounts on TIGER'}</span>
                    {searchingUsers && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  </div>

                  {!searchingUsers && matchingAccounts.length === 0 && filteredChats.length === 0 ? (
                    <div className="px-4 py-5 text-center text-xs text-zinc-500 space-y-1.5">
                      {selfMatchedInSearch ? (
                        <p>
                          {lang === 'ar'
                            ? 'هذا حسابك الشخصي. اكتب اسم حساب آخر أو @username أو البريد الإلكتروني لمراسلته.'
                            : 'This matches your own account. Search for another person’s name, @username, or email to message them.'}
                        </p>
                      ) : (
                        <p>
                          {lang === 'ar'
                            ? `لم يتم العثور على حساب مطابق لـ "${searchQuery.trim()}". تأكد من تسجيل دخول الحساب في TIGER مرة واحدة على الأقل.`
                            : `No account matched "${searchQuery.trim()}". Make sure that person has signed in to TIGER at least once.`}
                        </p>
                      )}
                    </div>
                  ) : (
                    matchingAccounts.map((u) => (
                      <button
                        key={`user-${u.id}`}
                        disabled={startingChatUserId === u.id}
                        onClick={() => void startDirectChat(u.id)}
                        className="w-full px-3.5 py-3 flex items-center gap-3 text-start hover:bg-orange-500/10 transition-colors disabled:opacity-60"
                      >
                        <UserAvatar src={u.avatarUrl} name={u.displayName} size="md" isOnline={u.isOnline} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{u.displayName}</div>
                          <div className="text-xs text-zinc-500 truncate">@{u.username}</div>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0">
                          {startingChatUserId === u.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <MessageSquare className="w-3 h-3" />
                          )}
                          {lang === 'ar' ? 'مراسلة' : 'Chat'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {!normalizedSearch && filteredChats.length === 0 && (
                <div className="p-6 text-center text-xs text-zinc-500 space-y-3">
                  <p>{t.chat.noChats}</p>
                  <button
                    onClick={() => {
                      setNewChatQuery('');
                      setShowNewChatModal(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {lang === 'ar' ? 'بدء محادثة جديدة' : 'Start New Chat'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Active Conversation Panel */}
      <section className="md:col-span-2 flex flex-col h-full min-h-0">
        {!activeChat ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-sm text-zinc-500 gap-3">
            <p>{t.chat.noChats}</p>
            <button
              onClick={() => {
                setNewChatQuery('');
                setShowNewChatModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" />
              {lang === 'ar' ? 'البحث عن حساب لمراسلته' : 'Find Account to Message'}
            </button>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  src={peerParticipant?.avatarUrl}
                  name={activeChat.chatType === 'group' ? activeChat.name || 'G' : peerParticipant?.displayName || 'U'}
                  size="sm"
                  isOnline={peerParticipant?.isOnline}
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">
                    {activeChat.chatType === 'group' ? activeChat.name : peerParticipant?.displayName}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {typingUser
                      ? `${typingUser} ${lang === 'ar' ? 'يكتب الآن...' : 'typing...'}`
                      : peerParticipant?.isOnline
                      ? lang === 'ar'
                        ? 'متصل الآن'
                        : 'Online'
                      : peerParticipant?.lastSeenAt
                      ? `${lang === 'ar' ? 'آخر ظهور:' : 'Last seen:'} ${new Date(
                          peerParticipant.lastSeenAt
                        ).toLocaleTimeString()}`
                      : `${activeChat.participants.length} ${lang === 'ar' ? 'أعضاء' : 'members'}`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {activeChat.chatType === 'direct' && (
                  <>
                    <button
                      onClick={() => setUseE2EE((v) => !v)}
                      title={
                        e2eeKeys
                          ? `Key Fingerprint: ${e2eeKeys.fingerprint}`
                          : 'WebCrypto ECDH-P256'
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1 ${
                        useE2EE ? 'bg-emerald-500/15 text-emerald-500' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {useE2EE ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">E2EE</span>
                    </button>
                    <button
                      onClick={() => void startCall(false)}
                      className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      title={t.chat.voiceCall}
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void startCall(true)}
                      className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      title={t.chat.videoCall}
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </>
                )}

                <button
                  onClick={() =>
                    void apiFetch(`/api/chats/${activeChat.id}/settings`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isPinned: !activeChat.membership.isPinned }),
                    })
                      .then(() => loadChats())
                      .catch((err: any) => notifyToast(err?.message || 'Action failed', 'error'))
                  }
                  className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Pin"
                >
                  <Pin className={`w-4 h-4 ${activeChat.membership.isPinned ? 'text-orange-500' : ''}`} />
                </button>
                <button
                  onClick={() =>
                    void apiFetch(`/api/chats/${activeChat.id}/settings`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isMuted: !activeChat.membership.isMuted }),
                    })
                      .then(() => loadChats())
                      .catch((err: any) => notifyToast(err?.message || 'Action failed', 'error'))
                  }
                  className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Mute"
                >
                  <BellOff className={`w-4 h-4 ${activeChat.membership.isMuted ? 'text-orange-500' : ''}`} />
                </button>
                <button
                  onClick={() =>
                    void apiFetch(`/api/chats/${activeChat.id}/settings`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isArchived: !activeChat.membership.isArchived }),
                    })
                      .then(() => {
                        setSelectedChatId(null);
                        void loadChats();
                      })
                      .catch((err: any) => notifyToast(err?.message || 'Action failed', 'error'))
                  }
                  className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Archive"
                >
                  <Archive className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Active Live Location Sharing Banner */}
            {activeLiveShares
              .filter((s) => s.chatId === selectedChatId)
              .map((share) => (
                <div
                  key={share.id}
                  className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/30 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 text-emerald-500 font-semibold">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span>
                      {lang === 'ar' ? 'تشارك موقعك المباشر حالياً حتى' : 'Sharing live location until'}{' '}
                      {new Date(share.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void stopLiveShareInChat(share.id)}
                    className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                  >
                    {lang === 'ar' ? 'إيقاف المشاركة' : 'Stop Sharing'}
                  </button>
                </div>
              ))}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-50/50 dark:bg-zinc-950/40">
              {messages.map((m) => {
                const mine = m.senderId === user?.id;
                const displayText =
                  m.isDeleted
                    ? lang === 'ar'
                      ? 'تم حذف هذه الرسالة'
                      : 'This message was deleted'
                    : m.messageType === 'encrypted'
                    ? decryptedMap[m.id] || '🔒 Encrypted (ECDH-P256 AES-GCM)'
                    : m.content;

                return (
                  <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`group relative max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${
                        mine
                          ? 'bg-orange-500 text-white'
                          : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100'
                      }`}
                    >
                      {!mine && activeChat.chatType === 'group' && (
                        <div className="text-[11px] font-bold text-orange-500 mb-0.5">{m.sender?.displayName}</div>
                      )}

                      {m.replyToId && (
                        <div className="text-[11px] opacity-75 border-b border-current/20 pb-1 mb-1">
                          {lang === 'ar' ? 'رد على رسالة #' : 'Replying to #'}
                          {m.replyToId}
                        </div>
                      )}

                      {m.messageType === 'location' && m.locationData ? (() => {
                        const liveOverride = m.locationData.liveShareId
                          ? liveCoordsMap[m.locationData.liveShareId]
                          : undefined;
                        const lat = liveOverride && !liveOverride.stopped ? liveOverride.lat : m.locationData.lat;
                        const lng = liveOverride && !liveOverride.stopped ? liveOverride.lng : m.locationData.lng;
                        const isExpired =
                          Boolean(m.locationData.expiresAt) &&
                          new Date(m.locationData.expiresAt!).getTime() <= Date.now();
                        const isStopped = Boolean(m.locationData.stopped || liveOverride?.stopped || isExpired);
                        const isLiveActive = Boolean(m.locationData.isLive && !isStopped);

                        return (
                          <div className="space-y-2 min-w-[230px] sm:min-w-[260px]">
                            <div className="flex items-center justify-between gap-2 text-xs font-bold">
                              <span className="inline-flex items-center gap-1.5 truncate">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{m.locationData.label}</span>
                              </span>
                              {m.locationData.isLive && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                    isLiveActive
                                      ? 'bg-emerald-500 text-white'
                                      : 'bg-zinc-700 text-zinc-200'
                                  }`}
                                >
                                  {isLiveActive
                                    ? lang === 'ar'
                                      ? 'مباشر'
                                      : 'LIVE'
                                    : lang === 'ar'
                                    ? 'انتهت'
                                    : 'Ended'}
                                </span>
                              )}
                            </div>

                            {!isStopped || !m.locationData.isLive ? (
                              <div
                                onClick={() =>
                                  setPreviewMapLoc({
                                    lat,
                                    lng,
                                    label: m.locationData!.label,
                                    isLive: m.locationData!.isLive,
                                    stopped: isStopped,
                                  })
                                }
                                className="cursor-pointer rounded-xl overflow-hidden border border-black/15"
                              >
                                <TigerMapCanvas
                                  center={[lat, lng]}
                                  zoom={14}
                                  interactive={false}
                                  heightClass="h-36"
                                  markers={[
                                    {
                                      id: `msg-${m.id}`,
                                      lat,
                                      lng,
                                      title: m.locationData.label,
                                      kind: isLiveActive ? 'live' : 'picked',
                                    },
                                  ]}
                                />
                              </div>
                            ) : (
                              <div className="p-2.5 rounded-xl bg-black/15 text-[11px]">
                                {lang === 'ar'
                                  ? 'تم إيقاف مشاركة الموقع المباشر ومسح الإحداثيات.'
                                  : 'Live location sharing ended and coordinates were cleared.'}
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              {(!isStopped || !m.locationData.isLive) && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewMapLoc({
                                        lat,
                                        lng,
                                        label: m.locationData!.label,
                                        isLive: m.locationData!.isLive,
                                        stopped: isStopped,
                                      })
                                    }
                                    className="underline font-semibold"
                                  >
                                    {lang === 'ar' ? 'عرض على الخريطة' : 'View Map'}
                                  </button>
                                  <a
                                    href={buildExternalOsmUrl(lat, lng)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 underline"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>{lang === 'ar' ? 'فتح في الخرائط' : 'Open Maps'}</span>
                                  </a>
                                </>
                              )}
                              {mine && isLiveActive && m.locationData.liveShareId && (
                                <button
                                  type="button"
                                  onClick={() => void stopLiveShareInChat(m.locationData!.liveShareId!)}
                                  className="px-2 py-0.5 rounded bg-red-600 text-white font-semibold"
                                >
                                  {lang === 'ar' ? 'إيقاف' : 'Stop'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })() : (
                        displayText && <p className="whitespace-pre-wrap break-words">{displayText}</p>
                      )}

                      {m.attachments?.map((att) => (
                        <div key={att.id} className="mt-2">
                          {att.mimeType.startsWith('image/') ? (
                            <img src={att.url} alt={att.fileName} className="rounded-xl max-h-56 object-cover" />
                          ) : att.mimeType.startsWith('video/') ? (
                            <video src={att.url} controls className="rounded-xl max-h-56" />
                          ) : att.mimeType.startsWith('audio/') ? (
                            <audio src={att.url} controls className="max-w-full" />
                          ) : (
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 text-xs underline"
                            >
                              <FileText className="w-4 h-4" /> {att.fileName}
                            </a>
                          )}
                        </div>
                      ))}

                      <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] opacity-75 tabular-nums">
                        {m.messageType === 'encrypted' && <Lock className="w-2.5 h-2.5" />}
                        {m.isEdited && <span>{lang === 'ar' ? 'معدّلة' : 'edited'}</span>}
                        <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {mine &&
                          (m.readBy.length > 1 ? (
                            <CheckCheck className="w-3.5 h-3.5" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          ))}
                      </div>

                      {/* Quick hover actions */}
                      {!m.isDeleted && (
                        <div className="hidden group-hover:flex items-center gap-1 absolute -top-7 end-0 bg-zinc-900 text-zinc-100 rounded-lg px-1.5 py-1 shadow-lg text-xs z-10">
                          <button
                            onClick={() =>
                              void apiFetch(`/api/chats/messages/${m.id}/react`, {
                                method: 'POST',
                                body: JSON.stringify({ emoji: '❤️' }),
                              }).catch((err: any) => notifyToast(err?.message || 'Reaction failed', 'error'))
                            }
                            className="px-1 hover:scale-110"
                          >
                            ❤️
                          </button>
                          <button onClick={() => setReplyTo(m)} className="p-1 hover:text-orange-400">
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setForwardingMsg(m)} className="p-1 hover:text-orange-400">
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                          {mine && (
                            <>
                              <button
                                onClick={() => {
                                  setEditingMsg(m);
                                  setMsgInput(m.content);
                                }}
                                className="p-1 hover:text-orange-400"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() =>
                                  void apiFetch(`/api/chats/messages/${m.id}`, { method: 'DELETE' }).catch((err: any) =>
                                    notifyToast(err?.message || 'Delete failed', 'error')
                                  )
                                }
                                className="p-1 hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {Object.keys(m.reactions || {}).length > 0 && (
                      <div className="flex gap-1 mt-1 text-xs">
                        {Object.entries(m.reactions).map(([emoji, usersList]) => (
                          <span
                            key={emoji}
                            className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-[11px] tabular-nums"
                          >
                            {emoji} {usersList.length}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply / Edit Banner */}
            {(replyTo || editingMsg) && (
              <div className="px-4 py-2 bg-zinc-100 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
                <span className="truncate">
                  {editingMsg
                    ? `${lang === 'ar' ? 'تعديل:' : 'Editing:'} ${editingMsg.content}`
                    : `${lang === 'ar' ? 'رد على:' : 'Replying to:'} ${replyTo?.content}`}
                </span>
                <button
                  onClick={() => {
                    setReplyTo(null);
                    setEditingMsg(null);
                    setMsgInput('');
                  }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Message Input Bar */}
            <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
              <label className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-zinc-600 dark:text-zinc-300">
                <Paperclip className="w-4 h-4" />
                <input
                  type="file"
                  multiple
                  onChange={(e) => void sendMessage(e.target.files)}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => void toggleVoiceRecording()}
                className={`p-2 rounded-xl ${
                  recording
                    ? 'bg-red-500 text-white'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
                title={t.chat.recordVoice}
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={openShareLocationModal}
                className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                title={t.chat.shareLocation}
              >
                <MapPin className="w-4 h-4 text-orange-500" />
              </button>

              <input
                value={msgInput}
                onChange={(e) => {
                  setMsgInput(e.target.value);
                  sendWs('chat:typing', {
                    chatId: selectedChatId,
                    targetUserIds: activeChat.participants.map((p) => p.id),
                    isTyping: e.target.value.length > 0,
                  });
                }}
                onKeyDown={(e) => e.key === 'Enter' && void sendMessage()}
                placeholder={t.chat.typeMessage}
                className="flex-1 px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
              />

              <button
                onClick={() => void sendMessage()}
                className="p-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </section>

      {/* Forward Message Modal */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{lang === 'ar' ? 'إعادة توجيه إلى' : 'Forward to'}</h3>
              <button onClick={() => setForwardingMsg(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {chats.map((c) => {
                const label =
                  c.chatType === 'group'
                    ? c.name || 'Group'
                    : c.participants.find((p) => p.id !== user?.id)?.displayName || 'Chat';
                return (
                  <button
                    key={c.id}
                    onClick={async () => {
                      try {
                        await apiFetch(`/api/chats/${c.id}/messages`, {
                          method: 'POST',
                          body: JSON.stringify({
                            content: forwardingMsg.content,
                            forwardedFromId: forwardingMsg.id,
                          }),
                        });
                        setForwardingMsg(null);
                        notifyToast(lang === 'ar' ? 'تمت إعادة التوجيه' : 'Forwarded', 'success');
                      } catch (err: any) {
                        notifyToast(err?.message || 'Forward failed', 'error');
                      }
                    }}
                    className="w-full text-start px-3 py-2 rounded-xl hover:bg-zinc-800 text-xs font-medium"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* New Direct Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'بدء محادثة جديدة' : 'Start New Direct Chat'}
              </h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5" />
              <input
                autoFocus
                value={newChatQuery}
                onChange={(e) => setNewChatQuery(e.target.value)}
                placeholder={
                  lang === 'ar'
                    ? 'اكتب الاسم، @username، أو البريد الإلكتروني...'
                    : 'Search by name, @username, or email...'
                }
                className="w-full ps-9 pe-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {loadingNewChatUsers ? (
                <div className="py-6 flex items-center justify-center text-xs text-zinc-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                  <span>{lang === 'ar' ? 'جاري البحث عن الحسابات...' : 'Searching accounts...'}</span>
                </div>
              ) : newChatUsers.length === 0 ? (
                <div className="py-6 px-3 text-center text-xs text-zinc-500">
                  {newChatQuery.trim()
                    ? lang === 'ar'
                      ? `لم يتم العثور على حساب مطابق لـ "${newChatQuery.trim()}". تأكد أن الحساب سجّل الدخول إلى TIGER مرة واحدة على الأقل.`
                      : `No matching account found for "${newChatQuery.trim()}". Accounts appear once they sign in to TIGER.`
                    : lang === 'ar'
                    ? 'لا توجد حسابات أخرى مسجلة حالياً في قاعدة البيانات بعد. بمجرد تسجيل دخول حساب آخر سيظهر هنا فوراً.'
                    : 'No other registered accounts yet. As soon as another user signs in to TIGER, they will appear here.'}
                </div>
              ) : (
                newChatUsers.map((u) => (
                  <button
                    key={u.id}
                    disabled={startingChatUserId === u.id}
                    onClick={() => void startDirectChat(u.id)}
                    className="w-full py-2.5 px-2 flex items-center gap-3 text-start rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors disabled:opacity-60"
                  >
                    <UserAvatar src={u.avatarUrl} name={u.displayName} size="sm" isOnline={u.isOnline} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{u.displayName}</div>
                      <div className="text-xs text-zinc-500 truncate">@{u.username}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-xs font-semibold">
                      {startingChatUserId === u.id
                        ? '...'
                        : lang === 'ar'
                        ? 'مراسلة'
                        : 'Message'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Group Chat Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{t.chat.newGroup}</h3>
              <button onClick={() => setShowGroupModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={lang === 'ar' ? 'اسم المجموعة' : 'Group name'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <div className="max-h-52 overflow-y-auto space-y-1.5">
              {allUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-800 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGroupUsers.includes(u.id)}
                    onChange={(e) =>
                      setSelectedGroupUsers((prev) =>
                        e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                      )
                    }
                  />
                  <span>{u.displayName}</span>
                  <span className="text-zinc-500">@{u.username}</span>
                </label>
              ))}
            </div>
            <button
              onClick={() => void createGroupChat()}
              className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
            >
              {lang === 'ar' ? 'إنشاء المحادثة الجماعية' : 'Create Group Chat'}
            </button>
          </div>
        </div>
      )}

      {/* WebRTC Voice / Video Call Modal */}
      {callState?.active && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border border-zinc-800 bg-zinc-950 text-white p-6 space-y-5 text-center">
            <h3 className="text-lg font-bold">{callState.peerName}</h3>
            <p className="text-xs text-orange-400">
              {callState.incoming
                ? lang === 'ar'
                  ? 'مكالمة واردة...'
                  : 'Incoming call...'
                : lang === 'ar'
                ? 'مكالمة WebRTC متصلة'
                : 'WebRTC Call Connected'}
            </p>

            {callState.video && (
              <div className="grid grid-cols-2 gap-3">
                <video ref={localVideoRef} autoPlay muted playsInline className="rounded-xl bg-black aspect-video object-cover" />
                <video ref={remoteVideoRef} autoPlay playsInline className="rounded-xl bg-black aspect-video object-cover" />
              </div>
            )}

            <div className="flex items-center justify-center gap-4">
              {callState.incoming && (
                <button
                  onClick={() => void acceptIncomingCall()}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2"
                >
                  <Phone className="w-4 h-4" /> {lang === 'ar' ? 'رد' : 'Accept'}
                </button>
              )}
              <button
                onClick={() => {
                  sendWs(callState.incoming ? 'call:reject' : 'call:end', { targetUserId: callState.peerId });
                  endLocalCall();
                }}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center gap-2"
              >
                <PhoneOff className="w-4 h-4" /> {lang === 'ar' ? 'إنهاء' : 'End'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Location Modal (Current Snapshot OR Live Location 15m / 1h / 8h) */}
      {showLocationModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-orange-500" />
                <span>{lang === 'ar' ? 'مشاركة الموقع في المحادثة' : 'Share Location in Chat'}</span>
              </h3>
              <button onClick={() => setShowLocationModal(false)} className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            {locLoading ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                <span>{lang === 'ar' ? 'جاري تحديد موقعك الحالي عبر GPS...' : 'Detecting your current GPS position...'}</span>
              </div>
            ) : locError ? (
              <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-500 space-y-3">
                <p>{locError}</p>
                <button
                  type="button"
                  onClick={() => void fetchLocationForModal()}
                  className="px-3 py-1.5 rounded-lg bg-orange-500 text-white font-semibold"
                >
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Try Again'}
                </button>
              </div>
            ) : locFix ? (
              <>
                <TigerMapCanvas
                  center={[locFix.lat, locFix.lng]}
                  zoom={15}
                  heightClass="h-52"
                  markers={[
                    {
                      id: 'my-fix',
                      lat: locFix.lat,
                      lng: locFix.lng,
                      title: locFix.label,
                      kind: 'me',
                    },
                  ]}
                />

                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs space-y-1">
                  <div className="font-bold flex items-center justify-between gap-2">
                    <span className="truncate">{locFix.label}</span>
                    <button
                      type="button"
                      onClick={() => void fetchLocationForModal()}
                      className="text-orange-500 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <LocateFixed className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
                    </button>
                  </div>
                  <div className="text-zinc-500 font-mono tabular-nums">
                    {locFix.lat.toFixed(5)}, {locFix.lng.toFixed(5)}
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    disabled={sendingLoc}
                    onClick={() => void sendStaticLocationToChat()}
                    className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center justify-center gap-2"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>{lang === 'ar' ? 'إرسال موقعي الحالي' : 'Send Current Location'}</span>
                  </button>

                  <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2.5">
                    <div className="text-xs font-bold text-emerald-500 flex items-center gap-1.5">
                      <Radio className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'مشاركة الموقع المباشر' : 'Share Live Location'}</span>
                    </div>
                    <div className="flex gap-1.5">
                      {([
                        { mins: 15, labelAr: '15 دقيقة', labelEn: '15 mins' },
                        { mins: 60, labelAr: 'ساعة واحدة', labelEn: '1 hour' },
                        { mins: 480, labelAr: '8 ساعات', labelEn: '8 hours' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.mins}
                          type="button"
                          onClick={() => setLiveDuration(opt.mins)}
                          className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border ${
                            liveDuration === opt.mins
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                          }`}
                        >
                          {lang === 'ar' ? opt.labelAr : opt.labelEn}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={sendingLoc}
                      onClick={() => void startLiveLocationInChat()}
                      className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                    >
                      {lang === 'ar' ? 'بدء مشاركة الموقع المباشر' : 'Start Live Location'}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Full Map Preview Modal */}
      {previewMapLoc && (
        <LocationPreviewModal
          lat={previewMapLoc.lat}
          lng={previewMapLoc.lng}
          label={previewMapLoc.label}
          isLive={previewMapLoc.isLive}
          stopped={previewMapLoc.stopped}
          lang={lang}
          onClose={() => setPreviewMapLoc(null)}
        />
      )}
    </div>
  );
};
