import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ExternalLink, Pencil, Trash2, CalendarClock, MapPin } from 'lucide-react';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { listApplications, createApplication, updateApplication, deleteApplication } from '../services/applicationService.js';
import { listAnalyses } from '../services/analysisService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { getErrorMessage, getFieldErrors } from '../utils/errors.js';
import { formatDate, scoreTone } from '../utils/format.js';

const COLUMNS = [
  { key: 'saved', label: 'Saved' }, { key: 'applied', label: 'Applied' }, { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' }, { key: 'rejected', label: 'Rejected' },
];
const EMPTY = { company: '', roleTitle: '', status: 'saved', jobUrl: '', location: '', deadline: '', notes: '', jobAnalysisId: '' };
const toForm = (a) => ({ company: a.company, roleTitle: a.roleTitle, status: a.status, jobUrl: a.jobUrl ?? '', location: a.location ?? '', deadline: a.deadline ? a.deadline.slice(0, 10) : '', notes: a.notes ?? '', jobAnalysisId: a.analysis?.id ?? '' });

/** Add / edit form in a native dialog (focus trapping and Escape come from the browser). */
function ApplicationDialog({ editing, open, analyses, onClose, onSaved }) {
  const ref = useRef(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});

  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) { setForm(editing ? toForm(editing) : EMPTY); setError(''); setFields({}); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open, editing]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFields({});
    // Empty optional fields: omit on create, send null on update (null clears the stored value).
    const optional = (v) => (v.trim() === '' ? (editing ? null : undefined) : v.trim());
    const body = { company: form.company, roleTitle: form.roleTitle, status: form.status, jobUrl: optional(form.jobUrl), location: optional(form.location), notes: optional(form.notes),
      deadline: optional(form.deadline), jobAnalysisId: form.jobAnalysisId === '' ? (editing ? null : undefined) : form.jobAnalysisId };
    try { onSaved(editing ? await updateApplication(editing.id, body) : await createApplication(body), !editing); }
    catch (err) { const f = getFieldErrors(err); setFields(f); setError(Object.keys(f).length ? '' : getErrorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="app-title" className="m-auto w-[min(34rem,94vw)] rounded-panel border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-navy-950/50">
      <h2 id="app-title" className="text-lg font-bold">{editing ? 'Edit application' : 'Add an application'}</h2>
      <form onSubmit={save} noValidate className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Company" value={form.company} onChange={set('company')} error={fields.company} maxLength={100} required />
          <Field label="Role" value={form.roleTitle} onChange={set('roleTitle')} error={fields.roleTitle} maxLength={100} required />
          <label className="block text-sm font-semibold">Status
            <select value={form.status} onChange={set('status')} className="mt-1.5 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm">{COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </label>
          <Field label="Deadline" type="date" value={form.deadline} onChange={set('deadline')} error={fields.deadline} />
          <Field label="Job link" type="url" value={form.jobUrl} onChange={set('jobUrl')} error={fields.jobUrl} placeholder="https://" className="sm:col-span-2" />
          <Field label="Location" value={form.location} onChange={set('location')} maxLength={100} />
          <label className="block text-sm font-semibold">Resume analysis for this job
            <select value={form.jobAnalysisId} onChange={set('jobAnalysisId')} className="mt-1.5 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm">
              <option value="">None</option>{analyses.map((a) => <option key={a.id} value={a.id}>{(a.roleTitle || 'Untitled role')} ({a.score.overall}/100)</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">Notes
          <textarea rows={3} value={form.notes} onChange={set('notes')} maxLength={2000} className="mt-1.5 block w-full rounded-control border border-line p-3 text-sm font-normal" />
        </label>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Add application'}</Button></div>
      </form>
    </dialog>
  );
}

function Card({ app, onEdit, onDelete, onMove }) {
  const overdue = app.deadline && new Date(app.deadline) < new Date() && !['offer', 'rejected'].includes(app.status);
  return (
    <li className="rounded-card border border-line bg-surface p-3.5">
      <p className="font-bold leading-snug">{app.company}</p>
      <p className="text-sm text-muted">{app.roleTitle}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {app.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{app.location}</span>}
        {app.deadline && <span className={`inline-flex items-center gap-1 ${overdue ? 'font-semibold text-bad' : ''}`}><CalendarClock className="size-3" aria-hidden="true" />{overdue ? 'Overdue: ' : 'Due '}{formatDate(app.deadline)}</span>}
      </div>
      {app.analysis && <Link to={`/resume-analyzer/${app.analysis.id}`} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-navy-800 hover:underline">Resume match <Badge tone={scoreTone(app.analysis.score)}>{app.analysis.score}/100</Badge></Link>}
      {app.notes && <p className="mt-2 line-clamp-2 text-xs text-muted">{app.notes}</p>}
      <div className="mt-3 space-y-2 border-t border-line pt-2.5">
        <label className="sr-only" htmlFor={`mv-${app.id}`}>Move {app.company} to</label>
        <select id={`mv-${app.id}`} value={app.status} onChange={(e) => onMove(app, e.target.value)} className="min-h-9 w-full rounded-control border border-line bg-surface px-2 text-xs">{COLUMNS.map((c) => <option key={c.key} value={c.key}>Status: {c.label}</option>)}</select>
        <div className="flex items-center justify-end gap-1">
          {app.jobUrl && <a href={app.jobUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open job link for ${app.company}`} className="rounded-control p-2 text-muted hover:bg-navy-50 hover:text-ink"><ExternalLink className="size-4" aria-hidden="true" /></a>}
          <button type="button" onClick={() => onEdit(app)} aria-label={`Edit ${app.company}`} className="rounded-control p-2 text-muted hover:bg-navy-50 hover:text-ink"><Pencil className="size-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => onDelete(app)} aria-label={`Delete ${app.company}`} className="rounded-control p-2 text-muted hover:bg-bad-bg hover:text-bad"><Trash2 className="size-4" aria-hidden="true" /></button>
        </div>
      </div>
    </li>
  );
}

export default function ApplicationsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch(listApplications, []);
  const analyses = useFetch(() => listAnalyses(1, 50), []);
  const [dialog, setDialog] = useState({ open: false, editing: null });
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const apps = data ?? [];

  const move = async (app, status) => {
    try { await updateApplication(app.id, { status }); toast.success(`Moved ${app.company} to ${COLUMNS.find((c) => c.key === status).label}.`); reload(); }
    catch (err) { toast.error(getErrorMessage(err)); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await deleteApplication(toDelete.id); toast.success('Application deleted.'); setToDelete(null); reload(); }
    catch (err) { toast.error(getErrorMessage(err)); } finally { setDeleting(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Applications</h1>
          <p className="mt-2 max-w-2xl text-muted">Keep track of every job you are going for. Link a resume analysis to see how well your resume matched that job.</p>
        </div>
        <Button onClick={() => setDialog({ open: true, editing: null })}><Plus className="size-4" aria-hidden="true" />Add application</Button>
      </div>

      {loading && <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-5"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}
      {error && <div className="mt-8"><Alert>{getErrorMessage(error)}</Alert></div>}
      {data && apps.length === 0 && <div className="mt-8 rounded-panel border border-line bg-surface p-8 text-sm text-muted"><p className="font-bold text-ink">No applications yet</p><p className="mt-1">Add the jobs you are interested in and move them across the board as you progress.</p></div>}

      {data && apps.length > 0 && (
        <div className="mt-8 overflow-x-auto pb-2">
          <div className="flex flex-col gap-4 md:flex-row">
          {COLUMNS.map((col) => {
            const items = apps.filter((a) => a.status === col.key);
            return (
              <section key={col.key} aria-labelledby={`col-${col.key}`} className="min-w-0 rounded-card bg-navy-50/60 p-3 md:w-64 md:shrink-0">
                <h2 id={`col-${col.key}`} className="mb-3 flex items-center justify-between text-sm font-bold">{col.label}<span className="rounded-full bg-surface px-2 py-0.5 text-xs">{items.length}</span></h2>
                <ul className="space-y-3">{items.map((a) => <Card key={a.id} app={a} onEdit={(x) => setDialog({ open: true, editing: x })} onDelete={setToDelete} onMove={move} />)}</ul>
              </section>
            );
          })}
          </div>
        </div>
      )}

      <ApplicationDialog open={dialog.open} editing={dialog.editing} analyses={analyses.data?.analyses ?? []} onClose={() => setDialog({ open: false, editing: null })}
        onSaved={(_app, created) => { setDialog({ open: false, editing: null }); toast.success(created ? 'Application added.' : 'Application updated.'); reload(); }} />
      <ConfirmDialog open={!!toDelete} title="Delete this application?" loading={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)}>
        <strong>{toDelete?.company}</strong> ({toDelete?.roleTitle}) will be removed from your board. Any linked resume analysis is kept.
      </ConfirmDialog>
    </div>
  );
}
