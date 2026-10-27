import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, CheckCircle2, CircleAlert, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { getAiStatus } from '../services/aiService.js';
import { listDocuments, uploadDocument, deleteDocument } from '../services/documentService.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { ConsentCard } from '../components/ConsentCard.jsx';
import { SetupNotice, Code } from '../components/SetupNotice.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDate } from '../utils/format.js';

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function StatusBadge({ doc }) {
  if (doc.status === 'processing') return <Badge tone="warn"><Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />Processing</Badge>;
  if (doc.status === 'ready') return <Badge tone="ok"><CheckCircle2 className="mr-1 size-3" aria-hidden="true" />Ready</Badge>;
  return <Badge tone="bad"><CircleAlert className="mr-1 size-3" aria-hidden="true" />Failed</Badge>;
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const consent = user.preferences?.aiDataConsent?.given === true;
  const status = useFetch(getAiStatus, [consent]);
  const docs = useFetch(() => listDocuments(1, 50), []);
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const list = docs.data?.documents ?? [];
  const processing = list.some((d) => d.status === 'processing');
  const { refresh } = docs;

  // Embedding runs in the background on the server, so poll quietly until nothing is processing.
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [processing, refresh]);

  const embeddingReady = status.data?.embedding?.configured;
  const canUpload = consent && embeddingReady && !uploading;

  const onFile = async (file) => {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const { duplicate } = await uploadDocument(file);
      toast.success(duplicate ? 'You already uploaded this document.' : 'Uploaded. Making it searchable now…');
      docs.reload(); status.reload();
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try { await deleteDocument(toDelete.id); toast.success('Document and its search data deleted.'); setToDelete(null); docs.reload(); }
    catch (err) { toast.error(getErrorMessage(err)); }
    finally { setDeleting(false); }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Documents</h1>
      <p className="mt-2 max-w-2xl text-muted">Upload your own study notes as PDFs. They are split into passages and made searchable so the <Link to="/assistant" className="font-semibold text-navy-800 underline underline-offset-4">Technical AI Assistant</Link> can answer from them.</p>

      <div className="mt-8 space-y-4">
        {status.data && !embeddingReady && (
          <SetupNotice title="Document search is not set up on this server yet">
            <p>The site owner needs to set <Code>GEMINI_API_KEY</Code> and <Code>EMBEDDING_MODEL</Code> in <Code>server/.env</Code> and restart. Run <Code>npm run ai:check</Code> to see which embedding models your key can use.</p>
          </SetupNotice>
        )}
        {!consent && (
          <ConsentCard title="Before you upload notes">
            To make your notes searchable, this app sends their <strong className="text-ink">text</strong> (in small passages) to Google&apos;s embedding service. When you ask a question,
            your question and the most relevant passages go to Gemini. The PDF file itself is never stored or sent. Anything in your notes will be sent, so don&apos;t upload documents you wouldn&apos;t want processed.
          </ConsentCard>
        )}
      </div>

      <section className="mt-8 rounded-panel border border-line bg-surface p-6 sm:p-8">
        <input ref={inputRef} id="doc-file" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!canUpload} onChange={(e) => onFile(e.target.files?.[0])} />
        <label htmlFor="doc-file" className={`flex min-h-14 items-center justify-center gap-2 rounded-card border border-dashed border-navy-700/40 px-4 py-4 text-sm font-semibold text-navy-800 ${canUpload ? 'cursor-pointer hover:bg-navy-50' : 'cursor-not-allowed opacity-50'}`}>
          <Upload className="size-4" aria-hidden="true" />{uploading ? 'Uploading…' : 'Upload a PDF of your notes'}
        </label>
        <p className="mt-2 text-xs text-muted">Text-based PDFs only (no scans), up to 10 MB and 100 pages. {status.data?.knowledge && `${status.data.knowledge.uploads.remaining} of ${status.data.knowledge.uploads.limit} uploads left this hour.`}</p>
        <div className="mt-4"><Alert>{error}</Alert></div>
      </section>

      <section aria-labelledby="doc-list" className="mt-8">
        <h2 id="doc-list" className="text-lg font-bold">Your documents</h2>
        <div className="mt-4">
          {docs.loading && <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
          {docs.error && <Alert>{getErrorMessage(docs.error)}</Alert>}
          {docs.data && list.length === 0 && <div className="rounded-card border border-line bg-surface p-5"><EmptyState title="No documents yet">Upload a PDF of your notes to get started.</EmptyState></div>}
          <ul className="space-y-2">
            {list.map((d) => (
              <li key={d.id} className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
                <FileText className="mt-0.5 size-5 shrink-0 text-navy-700" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{d.filename}</p><StatusBadge doc={d} /></div>
                  <p className="mt-0.5 text-xs text-muted">{d.pageCount} page{d.pageCount === 1 ? '' : 's'} · {kb(d.sizeBytes)} · {d.status === 'ready' ? `${d.chunkCount} searchable passages` : ''} added {formatDate(d.createdAt)}</p>
                  {d.status === 'failed' && <p className="mt-1.5 text-sm text-bad">{d.error?.message}</p>}
                </div>
                <button type="button" onClick={() => setToDelete(d)} aria-label={`Delete ${d.filename}`} className="rounded-control p-2 text-muted hover:bg-bad-bg hover:text-bad"><Trash2 className="size-4" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ConfirmDialog open={!!toDelete} title="Delete this document?" loading={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)}>
        <strong>{toDelete?.filename}</strong> and all of its searchable passages and vectors will be permanently deleted. Old chat answers keep their text but lose the quoted passages from this document.
      </ConfirmDialog>
    </div>
  );
}
