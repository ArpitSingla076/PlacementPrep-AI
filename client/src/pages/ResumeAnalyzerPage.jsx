import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Trash2, Upload, Settings2, ChevronRight, History as HistoryIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { getAiStatus } from '../services/aiService.js';
import { listResumes, uploadResume, deleteResume } from '../services/resumeService.js';
import { createAnalysis, listAnalyses, deleteAnalysis } from '../services/analysisService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { ConsentCard } from '../components/ConsentCard.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDate, scoreTone } from '../utils/format.js';

// Mirrors the server defaults for instant feedback. The server is still the authority.
const JD_MIN = 100;
const JD_MAX = 10_000;

function AiSetupNotice({ status }) {
  if (status.configured) return null;
  return (
    <div role="alert" className="rounded-panel border border-warn/30 bg-warn-bg p-5 text-sm text-warn">
      <p className="flex items-center gap-2 font-bold"><Settings2 className="size-4" aria-hidden="true" /> AI is not set up on this server yet</p>
      <p className="mt-2">
        The site owner needs to add <code className="rounded bg-white/60 px-1">GEMINI_API_KEY</code> and <code className="rounded bg-white/60 px-1">LLM_MODEL</code> to{' '}
        <code className="rounded bg-white/60 px-1">server/.env</code> and restart the server. Run <code className="rounded bg-white/60 px-1">npm run ai:check</code> in the server folder to
        see which models your key can use. Until then, analysis is unavailable. You can still upload resumes.
      </p>
    </div>
  );
}

function ResumePicker({ resumes, selectedId, onSelect, onUploaded, onDelete }) {
  const inputRef = useRef(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const { resume, duplicate } = await uploadResume(file);
      toast.success(duplicate ? 'You already uploaded this resume. Selected it for you.' : 'Resume uploaded and read successfully.');
      onUploaded(resume);
    } catch (err) {
      setUploadError(getErrorMessage(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = ''; // allow choosing the same file again
    }
  };

  return (
    <fieldset>
      <legend className="text-sm font-bold">1. Choose a resume</legend>
      <div className="mt-3 space-y-2">
        {resumes.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-card border p-3 ${selectedId === r.id ? 'border-navy-700 bg-navy-50' : 'border-line bg-surface'}`}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input type="radio" name="resume" value={r.id} checked={selectedId === r.id} onChange={() => onSelect(r.id)} className="size-4 accent-navy-900" />
              <FileText className="size-5 shrink-0 text-navy-700" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.originalFilename}</span>
                <span className="block text-xs text-muted">{r.pageCount} page{r.pageCount === 1 ? '' : 's'} · uploaded {formatDate(r.createdAt)}</span>
              </span>
            </label>
            <button type="button" onClick={() => onDelete(r)} aria-label={`Delete ${r.originalFilename}`} className="rounded-control p-2 text-muted hover:bg-bad-bg hover:text-bad">
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}

        <div>
          <input ref={inputRef} id="resume-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => handleFile(e.target.files?.[0])} />
          <label htmlFor="resume-file"
            className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-navy-700/40 px-4 py-3 text-sm font-semibold text-navy-800 hover:bg-navy-50 focus-within:outline focus-within:outline-2 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
            <Upload className="size-4" aria-hidden="true" />
            {uploading ? 'Uploading and reading your PDF…' : resumes.length ? 'Upload another PDF' : 'Upload your resume (PDF)'}
          </label>
          <p className="mt-1.5 text-xs text-muted">Text-based PDF, up to 6 pages. Scanned or image-only PDFs can&apos;t be read.</p>
        </div>
        <Alert>{uploadError}</Alert>
      </div>
    </fieldset>
  );
}

function AnalysisHistory() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch(() => listAnalyses(page, 5), [page]);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteAnalysis(toDelete.id);
      toast.success('Analysis deleted.');
      setToDelete(null);
      if (data.analyses.length === 1 && page > 1) setPage(page - 1); else reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section aria-labelledby="history-title" className="mt-12">
      <h2 id="history-title" className="flex items-center gap-2 text-lg font-bold"><HistoryIcon className="size-5 text-navy-700" aria-hidden="true" /> Previous analyses</h2>
      <div className="mt-4">
        {loading && <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
        {error && <Alert>{getErrorMessage(error)}</Alert>}
        {data && data.analyses.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-5"><EmptyState title="No analyses yet">Run your first analysis above. Each report is saved here so you can reopen it later.</EmptyState></div>
        )}
        {data && data.analyses.length > 0 && (
          <>
            <ul className="space-y-2">
              {data.analyses.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 pr-2">
                  <Link to={`/resume-analyzer/${a.id}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-control p-1 hover:bg-navy-50">
                    <Badge tone={scoreTone(a.score.overall)}>{a.score.overall}/100</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.roleTitle || 'Untitled role'}</span>
                      <span className="block truncate text-xs text-muted">{a.resumeFilename} · {formatDate(a.createdAt)}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  </Link>
                  <button type="button" onClick={() => setToDelete(a)} aria-label={`Delete analysis for ${a.roleTitle || 'untitled role'}`} className="rounded-control p-2 text-muted hover:bg-bad-bg hover:text-bad">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
          </>
        )}
      </div>
      <ConfirmDialog open={!!toDelete} title="Delete this analysis?" loading={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)}>
        The report for <strong>{toDelete?.roleTitle || 'this role'}</strong> will be permanently deleted.
      </ConfirmDialog>
    </section>
  );
}

export default function ResumeAnalyzerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const status = useFetch(getAiStatus, [user.preferences?.aiDataConsent?.given]);
  const resumesQ = useFetch(() => listResumes(1, 20), []);
  const [selected, setSelected] = useState(null);
  const [jd, setJd] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [resumeToDelete, setResumeToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Bumped when server-side data changes elsewhere on the page (a resume delete cascades to analyses); remounts the history list.
  const [historyKey, setHistoryKey] = useState(0);

  const resumes = resumesQ.data?.resumes ?? [];
  const selectedId = selected ?? resumes[0]?.id ?? null; // default to the newest resume
  const consent = user.preferences?.aiDataConsent?.given === true;
  const ai = status.data;
  const jdLen = jd.trim().length;
  const jdOk = jdLen >= JD_MIN && jdLen <= JD_MAX;
  const canRun = !!selectedId && jdOk && consent && ai?.configured && !running;

  const run = async (e) => {
    e.preventDefault();
    setRunning(true);
    setError('');
    try {
      const { analysis, cached } = await createAnalysis({ resumeId: selectedId, jobDescription: jd });
      if (cached) toast.success('You already analysed this exact resume and job description, so here is the saved report.');
      navigate(`/resume-analyzer/${analysis.id}`);
    } catch (err) {
      setError(getErrorMessage(err));
      status.reload(); // refresh remaining quota
    } finally {
      setRunning(false);
    }
  };

  const confirmDeleteResume = async () => {
    setDeleting(true);
    try {
      const { deletedAnalyses } = await deleteResume(resumeToDelete.id);
      toast.success(`Resume deleted${deletedAnalyses ? ` along with ${deletedAnalyses} analysis report${deletedAnalyses === 1 ? '' : 's'}` : ''}.`);
      if (selected === resumeToDelete.id) setSelected(null);
      setResumeToDelete(null);
      resumesQ.reload();
      setHistoryKey((k) => k + 1);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Resume Analyzer</h1>
      <p className="mt-2 max-w-2xl text-muted">See how well your resume covers a job description, which skills are backed by evidence, and what to improve. Every piece of evidence is checked against your resume text.</p>

      <div className="mt-8 space-y-4">
        {status.error && <Alert>{getErrorMessage(status.error)}</Alert>}
        {ai && <AiSetupNotice status={ai} />}
        {!consent && <ConsentCard />}
      </div>

      <form onSubmit={run} className="mt-8 space-y-8 rounded-panel border border-line bg-surface p-6 sm:p-8">
        {resumesQ.loading ? (
          <div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-14" /></div>
        ) : resumesQ.error ? (
          <Alert>{getErrorMessage(resumesQ.error)}</Alert>
        ) : (
          <ResumePicker resumes={resumes} selectedId={selectedId} onSelect={setSelected}
            onUploaded={(r) => { setSelected(r.id); resumesQ.reload(); }} onDelete={setResumeToDelete} />
        )}

        <div>
          <label htmlFor="jd" className="text-sm font-bold">2. Paste the job description</label>
          <textarea id="jd" rows={10} value={jd} onChange={(e) => setJd(e.target.value)} maxLength={JD_MAX + 500}
            placeholder="Paste the full posting: responsibilities, requirements and preferred skills."
            aria-describedby="jd-count"
            className="mt-3 block w-full rounded-control border border-line bg-surface p-3 text-sm leading-relaxed placeholder:text-muted/70" />
          <p id="jd-count" className={`mt-1.5 text-xs ${jdLen > JD_MAX ? 'font-semibold text-bad' : 'text-muted'}`}>
            {jdLen.toLocaleString()} / {JD_MAX.toLocaleString()} characters{jdLen > 0 && jdLen < JD_MIN ? ` (at least ${JD_MIN} needed)` : ''}
          </p>
        </div>

        <Alert>{error}</Alert>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" loading={running} disabled={!canRun}>{running ? 'Analysing…' : 'Analyse match'}</Button>
          <p className="text-xs text-muted" aria-live="polite">
            {running
              ? 'Reading your resume and the job description. This usually takes 15 to 60 seconds. Please keep this page open.'
              : ai?.configured && consent ? `${ai.quota.remaining} of ${ai.quota.limit} new analyses left this hour. Repeats of the same input are free.` : ''}
          </p>
        </div>
      </form>

      <AnalysisHistory key={historyKey} />

      <ConfirmDialog open={!!resumeToDelete} title="Delete this resume?" confirmLabel="Delete resume" loading={deleting} onConfirm={confirmDeleteResume} onCancel={() => setResumeToDelete(null)}>
        <strong>{resumeToDelete?.originalFilename}</strong> and its extracted text will be permanently deleted, <strong>together with every analysis report made from it</strong>, because those reports quote your resume.
      </ConfirmDialog>
    </div>
  );
}
