import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import mammoth from 'mammoth';

export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_ROOT)) {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/pdf',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
]);

export function isAllowedMime(mime: string): boolean {
  if (ALLOWED_EXACT_MIMES.has(mime)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(path.basename(file.originalname)).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    const unique = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max single upload
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

export async function extractFileText(filePath: string, mimeType: string): Promise<string> {
  try {
    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      filePath.endsWith('.md') ||
      filePath.endsWith('.csv') ||
      filePath.endsWith('.ts') ||
      filePath.endsWith('.js')
    ) {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return raw.slice(0, 100_000);
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filePath.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value || '').slice(0, 100_000);
    }

    return '';
  } catch (err) {
    console.error('Text extraction failed:', err);
    return '';
  }
}

export function safeDeleteUploadedFile(storagePath: string) {
  try {
    const resolved = path.resolve(storagePath);
    if (resolved.startsWith(UPLOADS_ROOT) && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch (err) {
    console.error('Failed to delete file from disk:', err);
  }
}
