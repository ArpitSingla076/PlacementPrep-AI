import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Sparkles, BarChart3, FileSearch, Eye, FileText } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { getAiStatus } from '../services/aiService.js';
import { getPlan, generatePlan, setItemCompleted } from '../services/planService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ConsentCard } from '../components/ConsentCard.jsx';
import { SetupNotice, Code } from '../components/SetupNotice.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDateTime } from '../utils/format.js';

const PRIORITY = { high: 'bad', medium: 'warn', low: 'neutral' };
const EVIDENCE = {
  observed_performance: { label: 'Observed in your interviews', icon: BarChart3 },
  resume_analysis: { label: 'From your resume analysis', icon: FileSearch },
  limited_evidence: { label: 'Limited evidence: one answer', icon: Eye },
};

function Item({ item, onToggle, busy }) {
  const ev = EVIDENCE[item.evidenceType];
  const Icon = ev.icon;
  return (
    <li className={`rounded-card border p-5 ${item.completed ? 'border-ok/30 bg-ok-bg/40' : 'border-line bg-surface'}`}>
      <div className="flex items-start gap-3">
        <input id={`c-${item.key}`} type="checkbox" checked={item.completed} disabled={busy} onChange={(e) => onToggle(item.key, e.target.checked)} className="mt-1 size-4 accent-navy-900" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`c-${item.key}`} className={`cursor-pointer text-base font-bold ${item.completed ? 'line-through opacity-70' : ''}`}>{item.topic}</label>
            <Badge tone={PRIORITY[item.priority]}>{item.priority} priority</Badge>
            {item.completed && <Badge tone="ok">Done</Badge>}
          </div>
          {item.reopenedNote && <p className="mt-2 rounded-control bg-warn-bg p-2 text-xs text-warn">{item.reopenedNote}</p>}

          <div className="mt-3 rounded-control bg-canvas p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted"><Icon className="size-3.5" aria-hidden="true" />{ev.label}</p>
            <p className="mt-1 text-sm">{item.reason}</p>
          </div>

          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-navy-700"><Sparkles className="size-3.5" aria-hidden="true" />AI suggestion</p>
            <p className="mt-1 text-sm">{item.action}</p>
            <ul className="mt-2 space-y-1 text-sm">{item.practice.map((p, i) => <li key={i} className="flex gap-2"><Badge>{p.type}</Badge><span>{p.text}</span></li>)}</ul>
          </div>

          {item.relatedDocuments.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted"><FileText className="size-3.5" aria-hidden="true" />Your notes that mention this: {item.relatedDocuments.map((d) => <Link key={d.documentId} to="/documents" className="rounded-full border border-line px-2 py-0.5 font-semibold text-navy-800 hover:bg-navy-50">{d.filename}</Link>)}</p>
          )}
        </div>
      </div>
    </li>
  );
}

export default function PlanPage() {
  const { user } = useAuth();
  const toast = useToast();
  const consent = user.preferences?.aiDataConsent?.given === true;
  const status = useFetch(getAiStatus, [consent]);
  const { data: loaded, error, loading } = useFetch(getPlan, []);
  const [override, setOverride] = useState(undefined); // newest plan after generate / tick, without refetching
  const plan = override === undefined ? loaded : override;
  const [generating, setGenerating] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [genError, setGenError] = useState('');

  const generate = async () => {
    setGenerating(true); setGenError('');
    try { setOverride(await generatePlan()); toast.success('Plan updated from your latest results.'); }
    catch (err) { setGenError(getErrorMessage(err)); } finally { setGenerating(false); }
  };
  const toggle = async (key, completed) => {
    setBusyKey(key);
    try { setOverride(await setItemCompleted(key, completed)); } catch (err) { toast.error(getErrorMessage(err)); } finally { setBusyKey(null); }
  };
  const canGenerate = consent && status.data?.configured && !generating;

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Preparation Plan</h1>
      <p className="mt-2 max-w-2xl text-muted">Built from what you have actually done: your resume analysis and your mock interview results. Which topics appear, and their priority, are computed from your saved results. The AI only writes the study suggestions.</p>

      <div className="mt-6 space-y-4">
        {status.data && !status.data.configured && <SetupNotice title="AI is not set up on this server yet"><p>The site owner needs <Code>GEMINI_API_KEY</Code> and <Code>LLM_MODEL</Code> in <Code>server/.env</Code>.</p></SetupNotice>}
        {!consent && <ConsentCard title="Before you generate a plan">Topic names and computed scores (never your answers or resume text) are sent to the AI provider to write study suggestions.</ConsentCard>}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={generate} loading={generating} disabled={!canGenerate}><RefreshCw className="size-4" aria-hidden="true" />{plan ? 'Update plan from latest results' : 'Generate my plan'}</Button>
        {plan && <span className="text-xs text-muted">Last generated {formatDateTime(plan.generatedAt)} for {plan.targetRole}</span>}
      </div>
      <div className="mt-4"><Alert>{genError}</Alert></div>

      {loading && <div className="mt-6 space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>}
      {error && <div className="mt-6"><Alert>{getErrorMessage(error)}</Alert></div>}

      {!loading && !plan && !error && (
        <div className="mt-6 rounded-panel border border-line bg-surface p-8">
          <EmptyState title="No plan yet">A plan needs real results to work from. <Link to="/resume-analyzer" className="font-semibold text-navy-800 underline">Analyse your resume</Link> or <Link to="/interviews" className="font-semibold text-navy-800 underline">answer some mock interview questions</Link>, then generate your plan. We won&apos;t make one up.</EmptyState>
        </div>
      )}

      {plan && (
        <>
          {plan.stale && <p role="status" className="mt-6 rounded-control bg-warn-bg p-3 text-sm text-warn">You have new results since this plan was made. Update it so it reflects them.</p>}
          <section aria-label="Progress" className="mt-6 rounded-card border border-line bg-surface p-5">
            <div className="flex justify-between text-sm"><span className="font-semibold">{plan.progress.completed} of {plan.progress.total} done</span><span className="font-bold">{plan.progress.percent}%</span></div>
            <div className="mt-2 h-2.5 rounded-full bg-navy-100" role="img" aria-label={`${plan.progress.percent} percent complete`}><div className="h-2.5 rounded-full bg-ok" style={{ width: `${plan.progress.percent}%` }} /></div>
            <p className="mt-3 text-xs text-muted">Based on {plan.basis.answeredQuestions} answered interview question{plan.basis.answeredQuestions === 1 ? '' : 's'} across {plan.basis.interviewSessions} interview{plan.basis.interviewSessions === 1 ? '' : 's'}{plan.basis.analysisRole ? ` and your analysis for ${plan.basis.analysisRole} (${plan.basis.analysisScore}/100)` : ''}. Items you finish are reopened if new low scores arrive on the same topic.</p>
          </section>
          <ul className="mt-6 space-y-4">{plan.items.map((i) => <Item key={i.key} item={i} onToggle={toggle} busy={busyKey === i.key} />)}</ul>
        </>
      )}
    </div>
  );
}
