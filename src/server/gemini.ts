import fs from 'fs';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export type AiErrorCode =
  | 'API_KEY_MISSING'
  | 'API_KEY_INVALID'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'EMPTY_RESPONSE'
  | 'AI_UPSTREAM_ERROR';

const PRIMARY_TEXT_MODEL = 'gemini-4-hydrogen';
const FALLBACK_TEXT_MODEL = 'gemini-3.1-flash-lite';

// Short circuit-breaker so repeated 503 spikes on primary model don't stall every user message
let primaryCooldownUntil = 0;

function isPrimaryCoolingDown(): boolean {
  return Date.now() < primaryCooldownUntil;
}

function markPrimaryCooldown(ms = 60_000) {
  primaryCooldownUntil = Date.now() + ms;
}

function buildTextConfig(model: string, baseConfig: Record<string, any>) {
  if (model === PRIMARY_TEXT_MODEL) {
    return {
      ...baseConfig,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    };
  }
  return baseConfig;
}

export class GeminiServiceError extends Error {
  status: number;
  code: AiErrorCode;

  constructor(message: string, status: number, code: AiErrorCode) {
    super(message);
    this.name = 'GeminiServiceError';
    this.status = status;
    this.code = code;
  }
}

export function hasValidGeminiKey(): boolean {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

export function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiServiceError(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.',
      503,
      'API_KEY_MISSING'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function mapGeminiError(err: unknown): GeminiServiceError {
  if (err instanceof GeminiServiceError) return err;

  const anyErr = err as any;
  const rawMessage = String(anyErr?.message || anyErr || 'Unknown AI error');
  const status = Number(anyErr?.status || anyErr?.code || 0);
  const upper = rawMessage.toUpperCase();

  if (upper.includes('TIMEOUT') || upper.includes('TIMED OUT') || anyErr?.name === 'AbortError') {
    return new GeminiServiceError(
      'The AI request timed out while waiting for Gemini. Please try again.',
      504,
      'TIMEOUT'
    );
  }

  if (
    status === 400 &&
    (upper.includes('API_KEY_INVALID') || upper.includes('API KEY NOT VALID') || upper.includes('API_KEY'))
  ) {
    return new GeminiServiceError(
      'The GEMINI_API_KEY is invalid. Please check your key in Settings > Secrets.',
      403,
      'API_KEY_INVALID'
    );
  }

  if (
    status === 401 ||
    status === 403 ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('API KEY NOT VALID')
  ) {
    return new GeminiServiceError(
      'Gemini API key permission denied or invalid. Please check Settings > Secrets.',
      403,
      'API_KEY_INVALID'
    );
  }

  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA')) {
    return new GeminiServiceError(
      'Gemini API rate limit or quota reached. Please wait briefly or verify a billing-enabled key in Settings > Secrets.',
      429,
      'RATE_LIMITED'
    );
  }

  if (
    status === 503 ||
    upper.includes('"CODE":503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED')
  ) {
    return new GeminiServiceError(
      'Gemini AI service is temporarily experiencing high demand. Please try again in a moment.',
      503,
      'MODEL_UNAVAILABLE'
    );
  }

  if (status === 404 || upper.includes('NOT_FOUND')) {
    return new GeminiServiceError(
      'Requested Gemini model is unavailable or not found.',
      502,
      'MODEL_NOT_FOUND'
    );
  }

  if (
    upper.includes('FETCH FAILED') ||
    upper.includes('ECONNREFUSED') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('UND_ERR') ||
    upper.includes('NETWORK')
  ) {
    return new GeminiServiceError(
      'Connection error while contacting Gemini API. Please check network connectivity and retry.',
      502,
      'NETWORK_ERROR'
    );
  }

  return new GeminiServiceError(rawMessage || 'Gemini AI request failed.', 502, 'AI_UPSTREAM_ERROR');
}

export async function runWithTimeoutAndRetry<T>(
  operation: () => Promise<T>,
  options: { timeoutMs?: number; maxRetries?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxRetries = options.maxRetries ?? 1;

  let lastError: GeminiServiceError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race<T>([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new GeminiServiceError(
                  'The AI request timed out while waiting for Gemini. Please try again.',
                  504,
                  'TIMEOUT'
                )
              ),
            timeoutMs
          )
        ),
      ]);
      return result;
    } catch (err) {
      const mapped = mapGeminiError(err);
      lastError = mapped;

      const isTransient = mapped.code === 'NETWORK_ERROR' || mapped.code === 'AI_UPSTREAM_ERROR';
      if (!isTransient || attempt >= maxRetries) {
        throw mapped;
      }

      const backoffMs = 400 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new GeminiServiceError('Gemini AI request failed.', 502, 'AI_UPSTREAM_ERROR');
}

async function generateTextWithFallback(
  ai: GoogleGenAI,
  buildParams: (model: string) => any
) {
  const tryModels = isPrimaryCoolingDown()
    ? [FALLBACK_TEXT_MODEL]
    : [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];

  let lastError: GeminiServiceError | null = null;

  for (let i = 0; i < tryModels.length; i++) {
    const model = tryModels[i];
    try {
      return await runWithTimeoutAndRetry(() => ai.models.generateContent(buildParams(model)), {
        timeoutMs: model === PRIMARY_TEXT_MODEL ? 12_000 : 20_000,
        maxRetries: model === PRIMARY_TEXT_MODEL ? 0 : 1,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      lastError = mapped;

      if (model === PRIMARY_TEXT_MODEL && (mapped.code === 'MODEL_UNAVAILABLE' || mapped.code === 'TIMEOUT')) {
        markPrimaryCooldown(60_000);
      }

      const canFallback =
        i < tryModels.length - 1 &&
        (mapped.code === 'MODEL_UNAVAILABLE' ||
          mapped.code === 'TIMEOUT' ||
          mapped.code === 'NETWORK_ERROR' ||
          mapped.code === 'AI_UPSTREAM_ERROR');

      if (!canFallback) {
        throw mapped;
      }
    }
  }

  throw lastError || new GeminiServiceError('Gemini AI request failed.', 502, 'AI_UPSTREAM_ERROR');
}

const PRESET_INSTRUCTIONS: Record<string, string> = {
  article: 'The user wants a well-structured, engaging article with clear headings and concise paragraphs.',
  translate: 'The user wants an accurate, natural translation preserving tone and nuance.',
  summarize: 'The user wants a clear, concise summary highlighting the key takeaways and main points.',
  lesson: 'The user wants an easy-to-follow educational explanation with examples and step-by-step clarity.',
  code: 'The user wants expert software engineering and coding assistance with clean, working code examples.',
  ideas: 'The user wants creative, practical, and diverse ideas tailored to their request.',
};

function sanitizeHistory(
  history: Array<{ role: 'user' | 'model'; content: string }>
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const cleaned: Array<{ role: 'user' | 'model'; content: string }> = [];
  for (const item of history) {
    const text = (item.content || '').trim();
    if (!text) continue;
    const role = item.role === 'model' ? 'model' : 'user';
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${text}`;
    } else {
      cleaned.push({ role, content: text });
    }
  }

  // Ensure the final turn before the new user prompt is not a dangling user turn
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'user') {
    cleaned.pop();
  }

  return cleaned.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}

function buildAssistantRequestParts(params: {
  history: Array<{ role: 'user' | 'model'; content: string }>;
  prompt: string;
  taskPreset?: string;
  systemInstruction?: string;
}) {
  const sanitizedHistory = sanitizeHistory(params.history);
  const contents = [
    ...sanitizedHistory,
    {
      role: 'user',
      parts: [{ text: params.prompt.trim() }],
    },
  ];

  const presetGuidance =
    params.taskPreset && PRESET_INSTRUCTIONS[params.taskPreset]
      ? `\nTask focus: ${PRESET_INSTRUCTIONS[params.taskPreset]}`
      : '';

  const baseSystemInstruction =
    params.systemInstruction ||
    `You are TIGER AI, an expert multilingual intelligent assistant integrated into the TIGER platform.
- Respond quickly, clearly, and concisely while staying accurate and helpful. Never repeat prior replies.
- Detect the user's language automatically: respond in natural Arabic when the user writes in Arabic, and in natural English when the user writes in English (or follow explicit language requests).
- Support writing articles, translation, summarization, lesson explanations, coding help, message drafting, and brainstorming.${presetGuidance}`;

  return { contents, baseSystemInstruction };
}

export async function generateTigerAssistantReply(params: {
  history: Array<{ role: 'user' | 'model'; content: string }>;
  prompt: string;
  taskPreset?: string;
  systemInstruction?: string;
}) {
  const ai = getAiClient();
  const { contents, baseSystemInstruction } = buildAssistantRequestParts(params);

  const response = await generateTextWithFallback(ai, (model) => ({
    model,
    contents,
    config: buildTextConfig(model, {
      systemInstruction: baseSystemInstruction,
    }),
  }));

  const text = (response.text || '').trim();
  if (!text) {
    throw new GeminiServiceError(
      'Gemini returned an empty response. Please try rephrasing your question.',
      502,
      'EMPTY_RESPONSE'
    );
  }

  return text;
}

export async function generateTigerAssistantReplyStream(params: {
  history: Array<{ role: 'user' | 'model'; content: string }>;
  prompt: string;
  taskPreset?: string;
  systemInstruction?: string;
  signal?: AbortSignal;
  onChunk: (chunkText: string) => void;
}): Promise<string> {
  const ai = getAiClient();
  const { contents, baseSystemInstruction } = buildAssistantRequestParts(params);

  const tryModels = isPrimaryCoolingDown()
    ? [FALLBACK_TEXT_MODEL]
    : [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];

  let lastError: GeminiServiceError | null = null;

  for (let i = 0; i < tryModels.length; i++) {
    const model = tryModels[i];
    let emitted = false;
    let fullText = '';

    try {
      const timeoutMs = model === PRIMARY_TEXT_MODEL ? 12_000 : 25_000;
      const stream = await Promise.race([
        ai.models.generateContentStream({
          model,
          contents,
          config: buildTextConfig(model, {
            systemInstruction: baseSystemInstruction,
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new GeminiServiceError(
                  'The AI request timed out while waiting for Gemini. Please try again.',
                  504,
                  'TIMEOUT'
                )
              ),
            timeoutMs
          )
        ),
      ]);

      for await (const chunk of stream) {
        if (params.signal?.aborted) {
          throw new GeminiServiceError('Request cancelled by client.', 499, 'TIMEOUT');
        }
        const delta = chunk.text || '';
        if (delta) {
          emitted = true;
          fullText += delta;
          params.onChunk(delta);
        }
      }

      const trimmed = fullText.trim();
      if (!trimmed) {
        throw new GeminiServiceError(
          'Gemini returned an empty response. Please try rephrasing your question.',
          502,
          'EMPTY_RESPONSE'
        );
      }

      return trimmed;
    } catch (err) {
      if (params.signal?.aborted) {
        throw mapGeminiError(err);
      }
      const mapped = mapGeminiError(err);
      lastError = mapped;

      if (model === PRIMARY_TEXT_MODEL && (mapped.code === 'MODEL_UNAVAILABLE' || mapped.code === 'TIMEOUT')) {
        markPrimaryCooldown(60_000);
      }

      // Only fail over to secondary model if no text chunks have been streamed to client yet
      const canFallback =
        !emitted &&
        i < tryModels.length - 1 &&
        (mapped.code === 'MODEL_UNAVAILABLE' ||
          mapped.code === 'TIMEOUT' ||
          mapped.code === 'NETWORK_ERROR' ||
          mapped.code === 'AI_UPSTREAM_ERROR');

      if (!canFallback) {
        throw mapped;
      }
    }
  }

  throw lastError || new GeminiServiceError('Gemini AI request failed.', 502, 'AI_UPSTREAM_ERROR');
}

export interface DriveFileInput {
  id: number;
  name: string;
  mimeType: string;
  storagePath: string;
  extractedText: string | null;
}

async function buildDriveParts(files: DriveFileInput[], promptText: string) {
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

  for (const file of files) {
    if (file.extractedText && file.extractedText.trim().length > 0) {
      parts.push({
        text: `--- Document: ${file.name} (ID: ${file.id}) ---\n${file.extractedText.slice(0, 35000)}`,
      });
    } else if (
      (file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/')) &&
      fs.existsSync(file.storagePath)
    ) {
      const stat = fs.statSync(file.storagePath);
      if (stat.size <= 12 * 1024 * 1024) {
        const buffer = await fs.promises.readFile(file.storagePath);
        parts.push({
          text: `--- Binary Document: ${file.name} (ID: ${file.id}) ---`,
        });
        parts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: buffer.toString('base64'),
          },
        });
      } else {
        parts.push({
          text: `--- Document ${file.name} (ID: ${file.id}) exceeds 12MB inline analysis limit ---`,
        });
      }
    } else {
      parts.push({
        text: `--- Document metadata: ${file.name} (${file.mimeType}) ---`,
      });
    }
  }

  parts.push({ text: promptText });
  return parts;
}

export async function analyzeDriveFiles(params: {
  files: DriveFileInput[];
  action: 'summarize' | 'qa' | 'extract' | 'quiz' | 'folder_summary' | 'smart_search';
  question?: string;
  language?: 'ar' | 'en';
}) {
  const ai = getAiClient();
  const langLabel = params.language === 'en' ? 'English' : 'Arabic';

  if (params.action === 'quiz') {
    const parts = await buildDriveParts(
      params.files,
      `Generate a 5-question multiple-choice quiz in ${langLabel} based strictly on the provided documents.`
    );

    const response = await generateTextWithFallback(ai, (model) => ({
      model,
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctIndex: { type: Type.INTEGER },
                  explanation: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    }));

    return {
      text: response.text || '{}',
      isQuiz: true,
    };
  }

  let taskPrompt = '';
  switch (params.action) {
    case 'summarize':
      taskPrompt = `Provide a clear, structured executive summary of these documents in ${langLabel}, with key sections and bulleted takeaways.`;
      break;
    case 'folder_summary':
      taskPrompt = `Synthesize an organized summary across all files in this folder in ${langLabel}, highlighting relationships, themes, and action items.`;
      break;
    case 'extract':
      taskPrompt = `Extract all key facts, dates, entities, metrics, and structured information from these documents in ${langLabel}.`;
      break;
    case 'smart_search':
      taskPrompt = `Search through the provided documents for: "${params.question || ''}". Quote matching sections, cite file names, and answer in ${langLabel}.`;
      break;
    case 'qa':
    default:
      taskPrompt = `Answer the user's question accurately based strictly on the provided documents in ${langLabel}.\nQuestion: ${params.question || 'Explain the main points.'}`;
      break;
  }

  const parts = await buildDriveParts(params.files, taskPrompt);
  const response = await generateTextWithFallback(ai, (model) => ({
    model,
    contents: { parts },
    config: {
      systemInstruction:
        'You are TIGER DRIVE AI, a secure document intelligence assistant. Only reference information present in the provided authorized user documents. Cite document names clearly.',
    },
  }));

  const text = (response.text || '').trim();
  if (!text) {
    throw new GeminiServiceError('Gemini returned an empty analysis.', 502, 'EMPTY_RESPONSE');
  }

  return {
    text,
    isQuiz: false,
  };
}
