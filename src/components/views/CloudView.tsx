import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FileText,
  Image as ImageIcon,
  Video,
  Upload,
  FolderPlus,
  Trash2,
  RotateCcw,
  Share2,
  Copy,
  Edit3,
  Download,
  Sparkles,
  Search,
  Eye,
  X,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth, useT } from '../../context/AuthContext';
import { LoadingSkeleton } from '../ErrorBoundary';

interface CloudFolder {
  id: number;
  parentId: number | null;
  name: string;
  createdAt: string;
}

interface CloudFile {
  id: number;
  folderId: number | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  publicUrl: string;
  isTrashed: boolean;
  createdAt: string;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const CloudView: React.FC = () => {
  const { lang, notifyToast, refreshUser } = useAuth();
  const t = useT();

  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [storageUsed, setStorageUsed] = useState(0);
  const [storageQuota, setStorageQuota] = useState(104857600);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: number | null; name: string }>>([]);
  const [trashView, setTrashView] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Modals
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [renamingFile, setRenamingFile] = useState<CloudFile | null>(null);
  const [renameText, setRenameText] = useState('');
  const [shareTargetFile, setShareTargetFile] = useState<CloudFile | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [sharePerm, setSharePerm] = useState<'view' | 'edit'>('view');

  // TIGER DRIVE AI State
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [quizData, setQuizData] = useState<{
    title: string;
    questions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>;
  } | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});

  const loadDrive = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (currentFolderId) params.set('folderId', String(currentFolderId));
      if (trashView) params.set('trash', 'true');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const res = await apiFetch<{
        folders: CloudFolder[];
        files: CloudFile[];
        storageUsedBytes: number;
        storageQuotaBytes: number;
      }>(`/api/cloud?${params.toString()}`);

      setFolders(res.folders || []);
      setFiles(res.files || []);
      setStorageUsed(res.storageUsedBytes || 0);
      setStorageQuota(res.storageQuotaBytes || 104857600);
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to load cloud drive', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, trashView, searchQuery, notifyToast]);

  useEffect(() => {
    void loadDrive();
  }, [loadDrive]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(selected).forEach((f) => fd.append('files', f));
      if (currentFolderId) fd.append('folderId', String(currentFolderId));
      await apiFetch('/api/cloud/upload', { method: 'POST', body: fd });
      await loadDrive();
      await refreshUser();
      notifyToast(lang === 'ar' ? 'تم رفع الملفات بنجاح' : 'Files uploaded', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Upload failed', 'error');
    } finally {
      e.target.value = '';
      setUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await apiFetch('/api/cloud/folders', {
        method: 'POST',
        body: JSON.stringify({ name: newFolderName.trim(), parentId: currentFolderId }),
      });
      setShowNewFolder(false);
      setNewFolderName('');
      await loadDrive();
    } catch (err: any) {
      notifyToast(err?.message || 'Failed to create folder', 'error');
    }
  };

  const handleFileAction = async (file: CloudFile, action: 'trash' | 'restore' | 'delete' | 'copy') => {
    try {
      if (action === 'trash' || action === 'restore') {
        await apiFetch(`/api/cloud/files/${file.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isTrashed: action === 'trash' }),
        });
      } else if (action === 'delete') {
        await apiFetch(`/api/cloud/files/${file.id}`, { method: 'DELETE' });
      } else if (action === 'copy') {
        await apiFetch(`/api/cloud/files/${file.id}/copy`, { method: 'POST', body: JSON.stringify({}) });
      }
      await loadDrive();
      await refreshUser();
    } catch (err: any) {
      notifyToast(err?.message || 'Action failed', 'error');
    }
  };

  const handleRename = async () => {
    if (!renamingFile || !renameText.trim()) return;
    try {
      await apiFetch(`/api/cloud/files/${renamingFile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fileName: renameText.trim() }),
      });
      setRenamingFile(null);
      await loadDrive();
    } catch (err: any) {
      notifyToast(err?.message || 'Rename failed', 'error');
    }
  };

  const generateShareLink = async () => {
    if (!shareTargetFile) return;
    try {
      const res = await apiFetch<{ share: { shareToken: string } }>('/api/cloud/share', {
        method: 'POST',
        body: JSON.stringify({ fileId: shareTargetFile.id, permission: sharePerm, expiresInHours: 168 }),
      });
      const url = `${window.location.origin}/?share=${res.share.shareToken}`;
      setShareUrl(url);
      navigator.clipboard?.writeText(url);
      notifyToast(lang === 'ar' ? 'تم إنشاء ونسخ رابط المشاركة الآمن' : 'Secure share link copied', 'success');
    } catch (err: any) {
      notifyToast(err?.message || 'Share failed', 'error');
    }
  };

  const runDriveAi = async (
    action: 'summarize' | 'qa' | 'extract' | 'quiz' | 'folder_summary' | 'smart_search'
  ) => {
    if (action !== 'folder_summary' && action !== 'smart_search' && selectedFileIds.length === 0) {
      return notifyToast(
        lang === 'ar' ? 'حدد ملفاً واحداً على الأقل أولاً' : 'Select at least one file first',
        'error'
      );
    }
    setAiLoading(true);
    setAiResult(null);
    setQuizData(null);
    setQuizAnswers({});
    try {
      const res = await apiFetch<{ result: string; isQuiz: boolean }>('/api/ai/drive', {
        method: 'POST',
        body: JSON.stringify({
          fileIds: selectedFileIds,
          folderId: action === 'folder_summary' ? currentFolderId : undefined,
          action,
          question: aiQuestion,
          language: lang,
        }),
      });

      if (res.isQuiz) {
        try {
          setQuizData(JSON.parse(res.result));
        } catch {
          setAiResult(res.result);
        }
      } else {
        setAiResult(res.result);
      }
    } catch (err: any) {
      notifyToast(err?.message || 'Drive AI analysis failed', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const usagePct = Math.min(100, Math.round((storageUsed / Math.max(1, storageQuota)) * 100));

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Cloud Drive */}
      <div className="lg:col-span-2 space-y-5">
        {/* Header & Storage Bar */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-display font-bold">{t.cloud.title}</h2>
              <p className="text-xs text-zinc-500 tabular-nums">
                {t.cloud.storageUsed}: {formatBytes(storageUsed)} / {formatBytes(storageQuota)} ({usagePct}%)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setTrashView((v) => !v)}
                className={`px-3 py-2 rounded-xl text-xs font-medium border ${
                  trashView
                    ? 'bg-red-500/15 border-red-500 text-red-500'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {trashView ? t.cloud.myDrive : t.cloud.trash}
              </button>
              <button
                onClick={() => setShowNewFolder(true)}
                className="px-3 py-2 rounded-xl text-xs font-medium border border-zinc-200 dark:border-zinc-800 inline-flex items-center gap-1.5"
              >
                <FolderPlus className="w-4 h-4 text-orange-500" /> {t.cloud.newFolder}
              </button>
              <label className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5">
                <Upload className="w-4 h-4" /> {uploading ? '...' : t.cloud.uploadFiles}
                <input type="file" multiple onChange={handleUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${usagePct}%` }} />
          </div>

          {/* Search & Breadcrumbs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => {
                  setCurrentFolderId(null);
                  setBreadcrumbs([]);
                }}
                className="font-semibold hover:text-orange-500"
              >
                {t.cloud.myDrive}
              </button>
              {breadcrumbs.map((b, idx) => (
                <React.Fragment key={b.id}>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  <button
                    onClick={() => {
                      setCurrentFolderId(b.id);
                      setBreadcrumbs((prev) => prev.slice(0, idx + 1));
                    }}
                    className="font-semibold hover:text-orange-500"
                  >
                    {b.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute start-3 top-2.5" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث في ملفاتك...' : 'Search drive...'}
                className="w-full ps-8 pe-3 py-1.5 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
              />
            </div>
          </div>
        </div>

        {/* Files & Folders List */}
        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {folders.map((folder) => (
              <div key={`folder-${folder.id}`} className="p-3.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-950/60">
                <button
                  onClick={() => {
                    setCurrentFolderId(folder.id);
                    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
                  }}
                  className="flex items-center gap-3 text-sm font-semibold"
                >
                  <Folder className="w-5 h-5 text-orange-500" />
                  <span>{folder.name}</span>
                </button>
                <button
                  onClick={() =>
                    void apiFetch(`/api/cloud/folders/${folder.id}`, { method: 'DELETE' })
                      .then(() => loadDrive())
                      .catch((err: any) => notifyToast(err?.message || 'Failed to delete folder', 'error'))
                  }
                  className="p-1.5 text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {files.length === 0 && folders.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500">
                {lang === 'ar' ? 'هذا المجلد فارغ. ارفع ملفاتك الآن!' : 'This folder is empty. Upload files to begin!'}
              </div>
            ) : (
              files.map((file) => {
                const selected = selectedFileIds.includes(file.id);
                return (
                  <div
                    key={file.id}
                    className={`p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                      selected ? 'bg-orange-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-950/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) =>
                          setSelectedFileIds((prev) =>
                            e.target.checked ? [...prev, file.id] : prev.filter((id) => id !== file.id)
                          )
                        }
                      />
                      {file.mimeType.startsWith('image/') ? (
                        <ImageIcon className="w-5 h-5 text-orange-500 shrink-0" />
                      ) : file.mimeType.startsWith('video/') ? (
                        <Video className="w-5 h-5 text-orange-500 shrink-0" />
                      ) : (
                        <FileText className="w-5 h-5 text-orange-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{file.fileName}</div>
                        <div className="text-[11px] text-zinc-500 tabular-nums">
                          {formatBytes(file.fileSize)} · {new Date(file.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <a
                        href={file.publicUrl}
                        download={file.fileName}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => {
                          setShareTargetFile(file);
                          setShareUrl('');
                        }}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        title="Share"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void handleFileAction(file, 'copy')}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        title="Duplicate"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setRenamingFile(file);
                          setRenameText(file.fileName);
                        }}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        title="Rename"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      {file.isTrashed ? (
                        <>
                          <button
                            onClick={() => void handleFileAction(file, 'restore')}
                            className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10"
                            title="Restore"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => void handleFileAction(file, 'delete')}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10"
                            title="Delete Permanently"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => void handleFileAction(file, 'trash')}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500"
                          title="Move to Trash"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* TIGER DRIVE AI Panel */}
      <aside className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 h-fit">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-orange-500" />
          <h3 className="text-base font-display font-bold">{t.cloud.driveAiTitle}</h3>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {lang === 'ar'
            ? 'حدد ملفات PDF أو Word أو نصوصاً لتحليلها وتلخيصها وإنشاء اختبارات ذكية بعد التحقق من صلاحياتك.'
            : 'Select PDF, Word, or text files to summarize, extract insights, or build quizzes with strict permission verification.'}
        </p>

        <div className="text-xs font-mono text-orange-500 tabular-nums">
          {selectedFileIds.length} {lang === 'ar' ? 'ملفات محددة' : 'files selected'}
        </div>

        <input
          value={aiQuestion}
          onChange={(e) => setAiQuestion(e.target.value)}
          placeholder={lang === 'ar' ? 'اكتب سؤالك حول المستندات أو كلمة البحث...' : 'Ask a question or smart search...'}
          className="w-full px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
        />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            onClick={() => void runDriveAi('summarize')}
            disabled={aiLoading}
            className="px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold"
          >
            {t.cloud.summarizeFile}
          </button>
          <button
            onClick={() => void runDriveAi('qa')}
            disabled={aiLoading}
            className="px-3 py-2 rounded-xl bg-zinc-950 dark:bg-zinc-800 text-white font-semibold"
          >
            {t.cloud.askDocs}
          </button>
          <button
            onClick={() => void runDriveAi('extract')}
            disabled={aiLoading}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 font-medium"
          >
            {lang === 'ar' ? 'استخراج المعلومات' : 'Extract Info'}
          </button>
          <button
            onClick={() => void runDriveAi('quiz')}
            disabled={aiLoading}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 font-medium"
          >
            {t.cloud.generateQuiz}
          </button>
          <button
            onClick={() => void runDriveAi('folder_summary')}
            disabled={aiLoading || !currentFolderId}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 font-medium disabled:opacity-40"
          >
            {t.cloud.summarizeFolder}
          </button>
          <button
            onClick={() => void runDriveAi('smart_search')}
            disabled={aiLoading}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 font-medium"
          >
            {t.cloud.smartSearch}
          </button>
        </div>

        {aiLoading && <LoadingSkeleton rows={2} />}

        {aiResult && (
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-3.5 text-xs whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {aiResult}
          </div>
        )}

        {quizData && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            <h4 className="text-sm font-bold text-orange-500">{quizData.title}</h4>
            {quizData.questions?.map((q, qi) => (
              <div key={qi} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="font-semibold">
                  {qi + 1}. {q.question}
                </div>
                <div className="space-y-1">
                  {q.options?.map((opt, oi) => {
                    const picked = quizAnswers[qi] === oi;
                    const isRight = quizAnswers[qi] !== undefined && oi === q.correctIndex;
                    return (
                      <button
                        key={oi}
                        onClick={() => setQuizAnswers((prev) => ({ ...prev, [qi]: oi }))}
                        className={`w-full text-start px-2.5 py-1.5 rounded-lg border ${
                          isRight
                            ? 'border-emerald-500 bg-emerald-500/15'
                            : picked
                            ? 'border-red-500 bg-red-500/15'
                            : 'border-zinc-200 dark:border-zinc-800'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {quizAnswers[qi] !== undefined && (
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {q.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Modals: New Folder, Rename, Preview, Share */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-5 space-y-4">
            <h3 className="text-sm font-bold">{t.cloud.newFolder}</h3>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={lang === 'ar' ? 'اسم المجلد' : 'Folder Name'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs">
                {t.common.cancel}
              </button>
              <button onClick={() => void handleCreateFolder()} className="px-4 py-1.5 rounded-lg bg-orange-500 text-xs font-semibold">
                {t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingFile && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-5 space-y-4">
            <h3 className="text-sm font-bold">{lang === 'ar' ? 'إعادة تسمية الملف' : 'Rename File'}</h3>
            <input
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenamingFile(null)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs">
                {t.common.cancel}
              </button>
              <button onClick={() => void handleRename()} className="px-4 py-1.5 rounded-lg bg-orange-500 text-xs font-semibold">
                {t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareTargetFile && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'مشاركة آمنة:' : 'Secure Share:'} {shareTargetFile.fileName}
              </h3>
              <button onClick={() => setShareTargetFile(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={sharePerm}
              onChange={(e) => setSharePerm(e.target.value as 'view' | 'edit')}
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"
            >
              <option value="view">{lang === 'ar' ? 'صلاحية عرض فقط' : 'View Only'}</option>
              <option value="edit">{lang === 'ar' ? 'صلاحية تعديل' : 'Can Edit'}</option>
            </select>
            {shareUrl && (
              <div className="p-2.5 rounded-xl bg-zinc-950 border border-orange-500/40 text-xs break-all text-orange-400">
                {shareUrl}
              </div>
            )}
            <button onClick={() => void generateShareLink()} className="w-full py-2.5 rounded-xl bg-orange-500 text-xs font-semibold">
              {lang === 'ar' ? 'إنشاء ونسخ رابط المشاركة' : 'Generate & Copy Share Link'}
            </button>
          </div>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <div className="max-w-3xl w-full rounded-2xl border border-zinc-800 bg-zinc-950 text-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold truncate">{previewFile.fileName}</span>
              <button onClick={() => setPreviewFile(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto flex items-center justify-center bg-black rounded-xl p-2">
              {previewFile.mimeType.startsWith('image/') ? (
                <img src={previewFile.publicUrl} alt={previewFile.fileName} className="max-h-[70vh] object-contain" />
              ) : previewFile.mimeType.startsWith('video/') ? (
                <video src={previewFile.publicUrl} controls autoPlay className="max-h-[70vh]" />
              ) : previewFile.mimeType === 'application/pdf' ? (
                <iframe src={previewFile.publicUrl} title={previewFile.fileName} className="w-full h-[70vh] rounded-lg" />
              ) : (
                <div className="p-8 text-center space-y-3">
                  <FileText className="w-12 h-12 mx-auto text-orange-500" />
                  <a
                    href={previewFile.publicUrl}
                    download={previewFile.fileName}
                    className="inline-block px-4 py-2 rounded-xl bg-orange-500 text-xs font-semibold"
                  >
                    {lang === 'ar' ? 'تنزيل الملف' : 'Download File'}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
