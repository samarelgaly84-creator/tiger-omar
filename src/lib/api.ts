import { auth } from './firebase';

let memoryIdToken: string | null = null;

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveWsUrl(path: string): string {
  if (API_BASE_URL) {
    try {
      const u = new URL(API_BASE_URL);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}${path.startsWith('/') ? path : `/${path}`}`;
    } catch {
      // Fallback to current host
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path.startsWith('/') ? path : `/${path}`}`;
}

export function setMemoryToken(token: string | null) {
  memoryIdToken = token;
}

export async function getFreshToken(forceRefresh = false): Promise<string | null> {
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken(forceRefresh);
      memoryIdToken = token;
      return token;
    } catch {
      return memoryIdToken;
    }
  }
  return memoryIdToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  isTimeout: boolean;
  isNetworkError: boolean;

  constructor(
    message: string,
    status: number,
    options?: { code?: string; isTimeout?: boolean; isNetworkError?: boolean }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options?.code;
    this.isTimeout = Boolean(options?.isTimeout);
    this.isNetworkError = Boolean(options?.isNetworkError);
  }
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

async function performRawFetch(
  url: string,
  fetchOptions: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
  forceTokenRefresh = false
): Promise<Response> {
  const token = await getFreshToken(forceTokenRefresh);
  const headers = new Headers(fetchOptions.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(fetchOptions.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  let didTimeout = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          didTimeout = true;
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    return await fetch(resolveApiUrl(url), { ...fetchOptions, headers, signal: controller.signal });
  } catch (err: any) {
    if (didTimeout || err?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 504, {
        code: 'TIMEOUT',
        isTimeout: true,
      });
    }
    throw new ApiError('Network connection error. Please check your internet connection.', 0, {
      code: 'NETWORK_ERROR',
      isNetworkError: true,
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

export async function apiFetch<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, signal: externalSignal, ...fetchOptions } = options;

  let res = await performRawFetch(url, fetchOptions, timeoutMs, externalSignal, false);

  // If server rejected token (401) while Firebase user is signed in, force-refresh once and retry
  if (res.status === 401 && auth.currentUser && !(fetchOptions.body instanceof ReadableStream)) {
    res = await performRawFetch(url, fetchOptions, timeoutMs, externalSignal, true);
  }

  let data: any = null;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const txt = await res.text();
    const looksLikeHtml = txt.trimStart().startsWith('<');
    if (res.ok && looksLikeHtml) {
      throw new ApiError(
        'Backend API (/api) is not active on this domain. Please connect the TIGER backend server.',
        502,
        { code: 'BACKEND_UNAVAILABLE' }
      );
    }
    data = { message: txt };
  }

  if (!res.ok) {
    throw new ApiError(data?.error || data?.message || `Request failed (${res.status})`, res.status, {
      code: data?.code,
    });
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError('Unexpected empty or invalid JSON response from server.', 502, {
      code: 'BACKEND_UNAVAILABLE',
    });
  }
  return data as T;
}

export interface StreamAiDonePayload<TMsg = any> {
  conversationId: number;
  userMessage?: TMsg;
  message: TMsg;
  credits?: { used: number; limit: number };
}

export async function streamAiChat<TMsg = any>(
  body: { prompt: string; conversationId: number | null; taskPreset?: string },
  handlers: {
    onDelta: (chunkText: string) => void;
    timeoutMs?: number;
  }
): Promise<StreamAiDonePayload<TMsg>> {
  const timeoutMs = handlers.timeoutMs ?? 35_000;

  const controller = new AbortController();
  let didTimeout = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  };

  const openStream = async (forceRefresh: boolean) => {
    const token = await getFreshToken(forceRefresh);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(resolveApiUrl('/api/ai/chat/stream'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  };

  resetTimer();

  let res: Response;
  try {
    res = await openStream(false);
    if (res.status === 401 && auth.currentUser) {
      res = await openStream(true);
    }
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    if (didTimeout || err?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 504, {
        code: 'TIMEOUT',
        isTimeout: true,
      });
    }
    throw new ApiError('Network connection error. Please check your internet connection.', 0, {
      code: 'NETWORK_ERROR',
      isNetworkError: true,
    });
  }

  if (!res.ok) {
    if (timer) clearTimeout(timer);
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, {
      code: data?.code,
    });
  }

  if (!res.body) {
    if (timer) clearTimeout(timer);
    throw new ApiError('Streaming response body missing.', 502, { code: 'AI_UPSTREAM_ERROR' });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload: StreamAiDonePayload<TMsg> | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetTimer();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        let evt: any;
        try {
          evt = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (evt.type === 'delta' && typeof evt.text === 'string') {
          handlers.onDelta(evt.text);
        } else if (evt.type === 'error') {
          throw new ApiError(evt.error || 'AI request failed', evt.code === 'API_KEY_INVALID' ? 403 : 502, {
            code: evt.code,
          });
        } else if (evt.type === 'done') {
          donePayload = evt as StreamAiDonePayload<TMsg>;
        }
      }
    }
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    if (didTimeout || err?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 504, {
        code: 'TIMEOUT',
        isTimeout: true,
      });
    }
    throw new ApiError(err?.message || 'Connection interrupted while streaming response.', 0, {
      code: 'NETWORK_ERROR',
      isNetworkError: true,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!donePayload) {
    throw new ApiError('Stream ended unexpectedly without completion.', 502, {
      code: 'NETWORK_ERROR',
      isNetworkError: true,
    });
  }

  return donePayload;
}

export function reportClientError(error: Error | string, route?: string) {
  try {
    const payload = {
      message: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'string' ? '' : error.stack || '',
      route: route || window.location.pathname,
    };
    void fetch(resolveApiUrl('/api/platform/monitoring/error'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // Ignore monitoring errors
  }
}
