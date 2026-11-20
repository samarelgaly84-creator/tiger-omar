import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send,
  Plus,
  Trash2,
  Bot,
  Sparkles,
  Code,
  Languages,
  FileText,
  GraduationCap,
  Lightbulb,
  AlertTriangle,
  RotateCcw,
  Loader2,
  MessageSquare,
  Copy,
  Check,
} from 'lucide-react';
import { apiFetch, ApiError, streamAiChat } from '../../lib/api';
import { useAuth, useT } from '../../context/AuthContext';
import { TIGER_AI_AVATAR } from '../BrandMark';

interface AiConv {
  id: number;
  title: string;
  mode: 'assistant' | 'drive_ai' | string;
  updatedAt: string;
}

interface AiMsg {
  id: number | string;
  role: 'user' | 'model';
  content: string;
}

interface ChatErrorState {
  code?: string;
  message: string;
  retryPrompt?: string;
}

const CHAT_PRESETS = [
  { key: 'article', labelAr: 'كتابة مقال', labelEn: 'Article', icon: FileText },
  { key: 'translate', labelAr: 'ترجمة', labelEn: 'Translate', icon: Languages },
  { key: 'summarize', labelAr: 'تلخيص', labelEn: 'Summarize', icon: Sparkles },
  { key: 'lesson', labelAr: 'شرح درس', labelEn: 'Explain Lesson', icon: GraduationCap },
  { key: 'code', labelAr: 'مساعدة برمجية', labelEn: 'Coding', icon: Code },
  { key: 'ideas', labelAr: 'توليد أفكار', labelEn: 'Ideas', icon: Lightbulb },
];

const QUICK_PROMPTS_AR = [
  { label: 'اكتب مقالاً احترافياً عن مستقبل الذكاء الاصطناعي', preset: 'article' },
  { label: 'لخّص أهم مبادئ البرمجة النظيفة في نقاط واضحة', preset: 'summarize' },
  { label: 'اشرح كيف يعمل التشفير من طرف إلى طرف (E2EE) ببساطة', preset: 'lesson' },
];

const QUICK_PROMPTS_EN = [
  { label: 'Write a concise article on modern full-stack architecture', preset: 'article' },
  { label: 'Explain how End-to-End Encryption works step-by-step', preset: 'lesson' },
  { label: 'Help me debug a TypeScript async race condition', preset: 'code' },
];

function formatAiErrorMessage(err: unknown, lang: 'ar' | 'en'): { message: string; code?: string } {
  const apiErr = err instanceof ApiError ? err : null;
  const code = apiErr?.code;
  const status = apiErr?.status;
  const raw = err instanceof Error ? err.message : String(err || '');

  if (code === 'API_KEY_MISSING') {
    return {
      code,
      message:
        lang === 'ar'
          ? 'مفتاح GEMINI_API_KEY غير مُضاف حالياً. يرجى إضافته في Settings > Secrets ثم إعادة المحاولة.'
          : 'GEMINI_API_KEY is not configured. Please add it in Settings > Secrets and try again.',
    };
  }

  if (code === 'API_KEY_INVALID' || status === 403) {
    return {
      code: code || 'API_KEY_INVALID',
      message:
        lang === 'ar'
          ? 'مفتاح Gemini API غير صالح أو غير مصرح به. يرجى التحقق من المفتاح في Settings > Secrets.'
          : 'The Gemini API key is invalid or unauthorized. Please check your key in Settings > Secrets.',
    };
  }

  if (code === 'CREDITS_EXHAUSTED') {
    return {
      code,
      message:
        lang === 'ar'
          ? 'انتهى رصيد الذكاء الاصطناعي الشهري لخطتك الحالية. قم بالترقية إلى TIGER PLUS أو PRO للمتابعة.'
          : 'Monthly AI credits exhausted for your current plan. Upgrade to TIGER PLUS or PRO to continue.',
    };
  }

  if (code === 'RATE_LIMITED' || status === 429) {
    return {
      code: 'RATE_LIMITED',
      message:
        lang === 'ar'
          ? 'تم تجاوز حد الطلبات أو الرصيد المتاح في خدمة Gemini (429). انتظر قليلاً ثم أعد المحاولة.'
          : 'Gemini API rate limit or quota reached (429). Please wait briefly and retry.',
    };
  }

  if (code === 'MODEL_UNAVAILABLE' || status === 503) {
    return {
      code: 'MODEL_UNAVAILABLE',
      message:
        lang === 'ar'
          ? 'خدمة الذكاء الاصطناعي تواجه ضغطاً مرتفعاً مؤقتاً (503). يرجى إعادة المحاولة بعد لحظات.'
          : 'The AI service is temporarily experiencing high demand (503). Please try again shortly.',
    };
  }

  if (code === 'TIMEOUT' || apiErr?.isTimeout || status === 504) {
    return {
      code: 'TIMEOUT',
      message:
        lang === 'ar'
          ? 'انتهت مهلة انتظار رد الذكاء الاصطناعي. يرجى التحقق من الاتصال وإعادة المحاولة.'
          : 'The AI request timed out while waiting for a response. Please try again.',
    };
  }

  if (code === 'NETWORK_ERROR' || apiErr?.isNetworkError || status === 502) {
    return {
      code: 'NETWORK_ERROR',
      message:
        raw ||
        (lang === 'ar'
          ? 'تعذر الاتصال بخادم TIGER AI أو خدمة Gemini. يرجى التأكد من الاتصال والمحاولة مجدداً.'
          : 'Connection error reaching the AI service. Please check your network and try again.'),
    };
  }

  if (status === 401) {
    return {
      code: 'UNAUTHORIZED',
      message:
        lang === 'ar'
          ? 'انتهت صلاحية جلسة الدخول. يرجى تحديث الصفحة أو إعادة تسجيل الدخول.'
          : 'Your session expired. Please refresh or sign in again.',
    };
  }

  return {
    code,
    message:
      raw ||
      (lang === 'ar'
        ? 'حدث خطأ غير متوقع أثناء معالجة طلب الذكاء الاصطناعي.'
        : 'An unexpected error occurred while processing the AI request.'),
  };
}

export const AiAssistantView: React.FC = () => {
  const { user, lang, notifyToast, refreshUser } = useAuth();
  const t = useT();

  const [conversations, setConversations] = useState<AiConv[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);

  const [taskPreset, setTaskPreset] = useState('');
  const [chatPrompt, setChatPrompt] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [chatError, setChatError] = useState<ChatErrorState | null>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: streamingContent ? 'auto' : 'smooth' });
  }, [messages, sendingChat, streamingContent, chatError]);

  const checkAiStatus = useCallback(async () => {
    if (!user?.id) return;
    try {
      const status = await apiFetch<{ configured: boolean }>('/api/ai/status', { timeoutMs: 10_000 });
      setKeyConfigured(status.configured);
    } catch {
      // Ignore status probe errors
    }
  }, [user?.id]);

  const loadConversations = useCallback(async () => {
    if (!user?.id) return;
    setLoadingConvs(true);
    try {
      const res = await apiFetch<{ conversations: AiConv[] }>('/api/ai/conversations', {
        timeoutMs: 15_000,
      });
      const chatOnly = (res.conversations || []).filter(
        (c) => c.mode === 'assistant' || c.mode === 'drive_ai'
      );
      setConversations(chatOnly);
    } catch (err) {
      const formatted = formatAiErrorMessage(err, lang);
      notifyToast(formatted.message, 'error');
    } finally {
      setLoadingConvs(false);
    }
  }, [user?.id, lang, notifyToast]);

  useEffect(() => {
    void loadConversations();
    void checkAiStatus();
  }, [loadConversations, checkAiStatus]);

  const startNewSession = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setChatError(null);
    setTimeout(() => chatInputRef.current?.focus(), 0);
  }, []);

  const selectConversation = async (id: number) => {
    setActiveConvId(id);
    setChatError(null);
    setLoadingMessages(true);
    try {
      const res = await apiFetch<{ conversation?: AiConv; messages: AiMsg[] }>(
        `/api/ai/conversations/${id}/messages`,
        { timeoutMs: 15_000 }
      );
      setMessages(res.messages || []);
    } catch (err) {
      const formatted = formatAiErrorMessage(err, lang);
      notifyToast(formatted.message, 'error');
    } finally {
      setLoadingMessages(false);
    }
  };

  const deleteConversation = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/ai/conversations/${id}`, { method: 'DELETE', timeoutMs: 15_000 });
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
      await loadConversations();
    } catch (err) {
      const formatted = formatAiErrorMessage(err, lang);
      notifyToast(formatted.message, 'error');
    }
  };

  const copyMessage = async (msg: AiMsg) => {
    try {
      await navigator.clipboard?.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((cur) => (cur === msg.id ? null : cur)), 1800);
    } catch {
      notifyToast(lang === 'ar' ? 'تعذر النسخ إلى الحافظة' : 'Copy failed', 'error');
    }
  };

  const handleSendChat = async (overridePrompt?: string, overridePreset?: string) => {
    const rawText = typeof overridePrompt === 'string' ? overridePrompt : chatPrompt;
    const text = rawText.trim();
    if (!text || sendingChat) return;

    const presetToUse = overridePreset ?? taskPreset;
    if (typeof overridePrompt !== 'string') setChatPrompt('');
    setChatError(null);
    setStreamingContent('');
    setSendingChat(true);

    const tempUserId = `temp-chat-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempUserId, role: 'user', content: text }]);

    try {
      const res = await streamAiChat<AiMsg>(
        { prompt: text, conversationId: activeConvId, taskPreset: presetToUse },
        {
          timeoutMs: 35_000,
          onDelta: (chunkText) => setStreamingContent((prev) => prev + chunkText),
        }
      );
      setActiveConvId(res.conversationId);
      setKeyConfigured(true);
      setStreamingContent('');
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserId),
        res.userMessage || { id: `u-${Date.now()}`, role: 'user', content: text },
        res.message,
      ]);
      void loadConversations();
      void refreshUser();
    } catch (err) {
      setStreamingContent('');
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      const formatted = formatAiErrorMessage(err, lang);
      if (formatted.code === 'API_KEY_MISSING' || formatted.code === 'API_KEY_INVALID') {
        setKeyConfigured(false);
      }
      setChatError({ code: formatted.code, message: formatted.message, retryPrompt: text });
      notifyToast(formatted.message, 'error');
    } finally {
      setSendingChat(false);
      setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  };

  const quickStarters = lang === 'ar' ? QUICK_PROMPTS_AR : QUICK_PROMPTS_EN;

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-140px)] min-h-[580px] rounded-2xl border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-[#111114] overflow-hidden grid grid-cols-1 md:grid-cols-4 shadow-sm">
      {/* Conversations History Sidebar */}
      <aside className="border-e border-zinc-200 dark:border-zinc-800/90 flex flex-col min-h-0 bg-zinc-50/70 dark:bg-[#0d0d10]">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/90 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={TIGER_AI_AVATAR}
                alt="TIGER AI"
                className="w-8 h-8 rounded-lg object-cover border border-orange-500/30 shrink-0"
              />
              <div className="min-w-0">
                <div className="font-display font-bold text-sm truncate text-zinc-950 dark:text-white">
                  {t.ai.title}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">{t.ai.assistantMode}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={startNewSession}
              className="px-2.5 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
              title={t.ai.newChat}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.ai.newChat}</span>
            </button>
          </div>
          {user && (
            <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono tabular-nums pt-1">
              <span>{lang === 'ar' ? 'رصيد الذكاء:' : 'AI Credits:'}</span>
              <span className="text-zinc-900 dark:text-zinc-200 font-semibold">
                {user.aiCreditsUsed} / {user.aiCreditsLimit}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingConvs && conversations.length === 0 ? (
            <div className="p-3 text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-500 space-y-2">
              <MessageSquare className="w-5 h-5 mx-auto opacity-50" />
              <p>{lang === 'ar' ? 'لا توجد محادثات سابقة بعد.' : 'No previous chats yet.'}</p>
            </div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => void selectConversation(c.id)}
                className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-xs cursor-pointer transition-colors ${
                  activeConvId === c.id
                    ? 'bg-orange-500/15 text-orange-500 font-semibold border border-orange-500/25'
                    : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="truncate flex-1 text-start">{c.title}</span>
                <button
                  type="button"
                  onClick={(e) => void deleteConversation(e, c.id)}
                  className="p-1 text-zinc-400 hover:text-red-500 shrink-0 opacity-75 group-hover:opacity-100"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat Workspace */}
      <section className="md:col-span-3 flex flex-col h-full min-h-0">
        {/* Top Preset Header */}
        <header className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800/90 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#111114]">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-900 dark:text-zinc-100">
            <Bot className="w-4 h-4 text-orange-500" />
            <span>{lang === 'ar' ? 'مساعد TIGER الذكي للمحادثة والكتابة والبرمجة' : 'TIGER Smart Assistant'}</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {CHAT_PRESETS.map((p) => {
              const Icon = p.icon;
              const selected = taskPreset === p.key;
              return (
                <button
                  type="button"
                  key={p.key}
                  onClick={() => setTaskPreset(selected ? '' : p.key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 border transition-colors ${
                    selected
                      ? 'border-orange-500 text-orange-500 bg-orange-500/10'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <Icon className="w-3 h-3" /> {lang === 'ar' ? p.labelAr : p.labelEn}
                </button>
              );
            })}
          </div>
        </header>

        {keyConfigured === false && (
          <div className="mx-5 mt-3 p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span>
              {lang === 'ar'
                ? 'تنبيه: مفتاح GEMINI_API_KEY غير مُضاف في Settings > Secrets.'
                : 'Notice: GEMINI_API_KEY is not configured in Settings > Secrets.'}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
              <span>{lang === 'ar' ? 'جاري تحميل المحادثة...' : 'Loading conversation...'}</span>
            </div>
          ) : messages.length === 0 && !sendingChat ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-5">
              <img
                src={TIGER_AI_AVATAR}
                alt="TIGER AI"
                className="w-16 h-16 rounded-2xl object-cover border border-orange-500/40 shadow-lg shadow-orange-500/10"
              />
              <div className="space-y-1.5">
                <h3 className="text-lg font-display font-bold text-zinc-950 dark:text-white">
                  {lang === 'ar' ? 'TIGER AI CHAT — المساعد الذكي' : 'TIGER AI CHAT — Intelligent Assistant'}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-md mx-auto">
                  {lang === 'ar'
                    ? 'تحدث بالعربية أو الإنجليزية: الإجابة عن الأسئلة، كتابة المقالات والرسائل، الترجمة والتلخيص، شرح الدروس، والمساعدة البرمجية.'
                    : 'Chat in Arabic or English: Q&A, articles & messages, translation, summarization, lesson explanations, and coding help.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full pt-2">
                {quickStarters.map((starter, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setTaskPreset(starter.preset);
                      void handleSendChat(starter.label, starter.preset);
                    }}
                    className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:border-orange-500/50 text-start text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed transition-colors"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`group relative max-w-[82%] rounded-2xl px-4 py-3 text-sm space-y-2 ${
                    m.role === 'user'
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100'
                  }`}
                >
                  {m.content && <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>}
                  {m.role === 'model' && m.content && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => void copyMessage(m)}
                        className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-orange-500 transition-colors"
                      >
                        {copiedId === m.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-500" />
                            <span>{lang === 'ar' ? 'تم النسخ' : 'Copied'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>{lang === 'ar' ? 'نسخ' : 'Copy'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {sendingChat && streamingContent ? (
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-2xl px-4 py-3 text-sm bg-zinc-100 dark:bg-zinc-950 border border-orange-500/30 text-zinc-900 dark:text-zinc-100">
                <p className="whitespace-pre-wrap leading-relaxed">{streamingContent}</p>
              </div>
            </div>
          ) : (
            sendingChat && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm bg-zinc-100 dark:bg-zinc-950 border border-orange-500/30">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                  <span className="font-medium text-orange-500">
                    {lang === 'ar' ? 'جاري التفكير...' : 'Thinking...'}
                  </span>
                </div>
              </div>
            )
          )}

          {chatError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-600 dark:text-red-300 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <span className="leading-relaxed">{chatError.message}</span>
              </div>
              {chatError.retryPrompt && !sendingChat && (
                <button
                  type="button"
                  onClick={() => void handleSendChat(chatError.retryPrompt)}
                  className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</span>
                </button>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800/90 flex items-center gap-2 bg-white dark:bg-[#111114]">
          <input
            ref={chatInputRef}
            value={chatPrompt}
            onChange={(e) => setChatPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendChat();
              }
            }}
            placeholder={t.ai.promptPlaceholder}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-orange-500"
          />
          <button
            type="button"
            onClick={() => void handleSendChat()}
            disabled={sendingChat || !chatPrompt.trim()}
            className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            {sendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>{t.ai.generate}</span>
          </button>
        </div>
      </section>
    </div>
  );
};
