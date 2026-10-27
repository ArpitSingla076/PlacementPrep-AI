import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleAlert, CircleX, Info, Quote, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useFetch } from '../hooks/useFetch.js';
import { useToast } from '../hooks/useToast.js';
import { getAnalysis, createAnalysis, deleteAnalysis, listAnalyses } from '../services/analysisService.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { ScoreRing } from '../components/ScoreRing.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDateTime, humanize } from '../utils/format.js';

const LEVEL = {
  demonstrated: { label: 'Demonstrated', tone: 'ok' },
  listed: { label: 'Listed only', tone: 'warn' },
  inferred: { label: 'AI inference', tone: 'warn' },
  none: { label: 'No evidence', tone: 'bad' },
};
const IMPORTANCE_TONE = { required: 'neutral', preferred: 'neutral', bonus: 'neutral' };

function Section({ id, title, icon: Icon, count, children, hint }) {
  return (
    <section aria-labelledby={id} className="rounded-panel border border-line bg-surface p-6 sm:p-8">
      <h2 id={id} className="flex items-center gap-2 text-lg font-bold">
        {Icon && <Icon className="size-5 text-navy-700" aria-hidden="true" />}
        {title}
        {count !== undefined && <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-800">{count}</span>}
      </h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function VerificationNote({ skill }) {
  if (skill.verification === 'quote_not_found' || skill.verification === 'quote_missing') {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warn">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        The AI claimed &ldquo;{LEVEL[skill.claimedLevel]?.label.toLowerCase()}&rdquo; evidence, but the quote it gave is not in your resume, so it was ignored and scored as no evidence.
      </p>
    );
  }
  if (skill.verification === 'term_not_in_quote') {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warn">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Downgraded: the skill is not actually named in the quoted text, so this counts as an inference.
      </p>
    );
  }
  return null;
}

function SkillRow({ skill }) {
  const level = LEVEL[skill.evidenceLevel];
  return (
    <li className="rounded-card border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">{skill.skill}</h3>
        <Badge tone={level.tone}>{level.label}</Badge>
        <Badge tone={IMPORTANCE_TONE[skill.importance]}>{skill.importance}</Badge>
        <span className="text-xs text-muted">{humanize(skill.category)}</span>
        <span className="ml-auto text-xs text-muted">worth {skill.weight} × {skill.credit} credit</span>
      </div>
      {skill.note && <p className="mt-2 text-sm text-muted">{skill.note}</p>}
      {skill.evidenceLevel !== 'none' && skill.evidenceQuote && (
        <blockquote className="mt-3 flex gap-2 border-l-2 border-navy-100 pl-3 text-sm italic text-ink">
          <Quote className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <span>{skill.evidenceQuote}</span>
        </blockquote>
      )}
      {skill.evidenceLevel === 'inferred' && <p className="mt-2 text-xs text-muted">Inferred by the AI from related work. Your resume does not name this skill, so add specifics only if it is true for you.</p>}
      <VerificationNote skill={skill} />
    </li>
  );
}

function SkillGroup({ id, title, icon, skills, empty, hint }) {
  return (
    <Section id={id} title={title} icon={icon} count={skills.length} hint={hint}>
      {skills.length === 0 ? <p className="text-sm text-muted">{empty}</p> : <ul className="space-y-3">{skills.map((s) => <SkillRow key={s.skill} skill={s} />)}</ul>}
    </Section>
  );
}

function ScoreCard({ a }) {
  const { score } = a;
  const c = score.counts;
  return (
    <section aria-labelledby="score-title" className="rounded-panel border border-line bg-surface p-6 sm:p-8">
      <div className="flex flex-col gap-8 md:flex-row md:items-center">
        <ScoreRing value={score.overall} size={148} />
        <div className="min-w-0 flex-1">
          <h2 id="score-title" className="text-lg font-bold">Estimated match: {score.overall} / 100</h2>
          <p className="mt-1 text-sm text-muted">{a.disclaimer}</p>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <li><Badge tone="ok">{c.demonstrated} demonstrated</Badge></li>
            <li><Badge tone="warn">{c.listed} listed only</Badge></li>
            <li><Badge tone="warn">{c.inferred} inferred</Badge></li>
            <li><Badge tone="bad">{c.none} no evidence</Badge></li>
          </ul>
        </div>
      </div>

      <h3 className="mt-8 text-sm font-bold">Score by importance</h3>
      <ul className="mt-3 space-y-3">
        {score.byImportance.map((g) => (
          <li key={g.key}>
            <div className="flex justify-between text-sm"><span className="font-medium capitalize">{g.key} <span className="text-muted">({g.count})</span></span><span className="font-semibold">{g.percent}%</span></div>
            <div className="mt-1 h-2 rounded-full bg-navy-100" role="img" aria-label={`${g.key}: ${g.percent} percent`}>
              <div className="h-2 rounded-full bg-navy-800" style={{ width: `${g.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>

      {c.unverifiedClaims > 0 && (
        <p className="mt-6 flex items-start gap-2 rounded-control bg-warn-bg p-3 text-sm text-warn">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {c.unverifiedClaims} evidence claim{c.unverifiedClaims === 1 ? '' : 's'} made by the AI could not be found in your resume and {c.unverifiedClaims === 1 ? 'was' : 'were'} scored as no evidence.
        </p>
      )}

      <details className="mt-6 rounded-card border border-line p-4">
        <summary className="cursor-pointer text-sm font-bold">How this score is calculated</summary>
        <div className="mt-3 space-y-4 text-sm">
          <p><code className="rounded bg-navy-50 px-1.5 py-0.5">{a.rubric.formula}</code></p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="font-semibold">Weight (from the job description)</p>
              <ul className="mt-1 space-y-1.5 text-muted">{a.rubric.weights.map((w) => <li key={w.key}><strong className="text-ink">{w.key} = {w.weight}</strong>. {w.meaning}</li>)}</ul>
            </div>
            <div>
              <p className="font-semibold">Credit (from the evidence in your resume)</p>
              <ul className="mt-1 space-y-1.5 text-muted">{a.rubric.credits.map((w) => <li key={w.key}><strong className="text-ink">{w.key} = {w.credit}</strong>. {w.meaning}</li>)}</ul>
            </div>
          </div>
          <p className="font-semibold">Total: {score.earned} earned of {score.possible} possible points.</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">{a.rubric.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      </details>
    </section>
  );
}

const PRIORITY_TONE = { high: 'bad', medium: 'warn', low: 'neutral' };

function Suggestions({ items }) {
  if (!items.length) return <p className="text-sm text-muted">No suggestions were generated.</p>;
  return (
    <ul className="space-y-3">
      {items.map((s, i) => (
        <li key={i} className="rounded-card border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{s.section}</h3>
            {s.needsUserVerification
              ? <Badge tone="warn">Only add if true for you</Badge>
              : <Badge tone="neutral">Improve existing text</Badge>}
          </div>
          {s.currentText && s.currentTextVerified && (
            <blockquote className="mt-3 border-l-2 border-navy-100 pl-3 text-sm italic text-muted">{s.currentText}</blockquote>
          )}
          <p className="mt-3 text-sm">{s.suggestion}</p>
          <p className="mt-1 text-xs text-muted">{s.reason}</p>
          {s.needsUserVerification && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warn">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Your resume does not show this. Please verify it is accurate before adding it. Never claim experience you don&apos;t have.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReportBody({ a, onRerun, rerunning }) {
  return (
    <div className="space-y-6">
      <ScoreCard a={a} />

      <SkillGroup id="demo" title="Demonstrated skills" icon={CheckCircle2} skills={a.skills.demonstrated}
        hint="Named in your resume and shown in use. Each quote below was checked against your resume text."
        empty="No required skill is clearly demonstrated in your resume yet." />
      <SkillGroup id="needs" title="Needs more evidence" icon={CircleAlert} skills={a.skills.needsEvidence}
        hint="Listed without an example of use, or only implied by related work."
        empty="Nothing here: every matched skill is backed by a concrete example." />
      <SkillGroup id="missing" title="Missing" icon={CircleX} skills={a.skills.missing}
        hint="No supporting evidence in the resume text. If you do have this skill, the resume does not show it."
        empty="Every requirement has at least some evidence." />

      <Section id="highlights" title="Relevant projects and experience" count={a.relevantHighlights.length}>
        {a.relevantHighlights.length === 0 ? <p className="text-sm text-muted">No verified highlights were found.</p> : (
          <ul className="space-y-3">{a.relevantHighlights.map((h, i) => (
            <li key={i} className="rounded-card border border-line p-4">
              <h3 className="text-sm font-bold">{h.item}</h3>
              <p className="mt-1 text-sm text-muted">{h.whyRelevant}</p>
              <blockquote className="mt-2 border-l-2 border-navy-100 pl-3 text-sm italic">{h.quote}</blockquote>
            </li>))}
          </ul>
        )}
      </Section>

      <Section id="suggest" title="Resume improvement suggestions" count={a.suggestions.length}
        hint="Suggestions never invent experience. Anything that adds a skill your resume does not show is marked and must be verified by you.">
        <Suggestions items={a.suggestions} />
      </Section>

      {a.resumeGaps.length > 0 && (
        <Section id="gaps" title="Missing or unclear information in the resume" count={a.resumeGaps.length}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">{a.resumeGaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </Section>
      )}

      <Section id="plan" title="Preparation checklist" count={a.preparationChecklist.length}
        hint="Ordered by how much of your score is at stake. Priority comes from the scoring rubric, not from the AI.">
        {a.preparationChecklist.length === 0 ? <p className="text-sm text-muted">No tasks were generated.</p> : (
          <ol className="space-y-2">{a.preparationChecklist.map((t, i) => (
            <li key={i} className="flex items-start gap-3 rounded-card border border-line p-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-bold text-navy-800">{i + 1}</span>
              <div className="min-w-0 flex-1 text-sm"><p>{t.task}</p><p className="mt-0.5 text-xs text-muted">Related: {t.relatedSkill}</p></div>
              <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
            </li>))}
          </ol>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Section id="topics" title="Topics likely to be tested" count={a.interviewTopics.length}>
          <ul className="space-y-3">{a.interviewTopics.map((t) => <li key={t.topic} className="text-sm"><p className="font-semibold">{t.topic}</p><p className="text-muted">{t.reason}</p></li>)}</ul>
        </Section>
        <Section id="questions" title="Potential interview questions" count={a.interviewQuestions.length}>
          <ul className="space-y-3">{a.interviewQuestions.map((q) => (
            <li key={q.question} className="text-sm"><p>{q.question}</p><p className="mt-0.5 text-xs text-muted">{q.topic} · {q.difficulty}</p></li>))}
          </ul>
        </Section>
      </div>

      <footer className="rounded-card border border-line bg-surface p-5 text-xs text-muted">
        <p>
          Generated {formatDateTime(a.createdAt)} by <strong className="text-ink">{a.ai.model}</strong> ({a.ai.provider}) · prompt {a.ai.promptVersion} · rubric {a.score.rubricVersion}
          {a.ai.repaired ? ' · the first AI response was invalid and was regenerated' : ''} · {a.ai.promptTokens?.toLocaleString()} input / {a.ai.outputTokens?.toLocaleString()} output tokens.
        </p>
        <p className="mt-1">Before sending, {a.ai.redactions?.emails ?? 0} email address(es) and {a.ai.redactions?.phones ?? 0} phone number(s) were removed from your resume text.</p>
        <Button variant="secondary" className="mt-4" onClick={onRerun} loading={rerunning}><RefreshCw className="size-4" aria-hidden="true" /> Re-run this analysis</Button>
        <span className="ml-3">Uses one of your hourly analyses and may give slightly different wording.</span>
      </footer>
    </div>
  );
}

export default function AnalysisReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: a, error, loading } = useFetch(() => getAnalysis(id), [id]);
  const others = useFetch(() => listAnalyses(1, 30), []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState('');

  const remove = async () => {
    setBusy(true);
    try { await deleteAnalysis(id); toast.success('Analysis deleted.'); navigate('/resume-analyzer', { replace: true }); }
    catch (err) { toast.error(getErrorMessage(err)); setBusy(false); }
  };

  const rerun = async () => {
    setRerunning(true);
    setRerunError('');
    try {
      const { analysis } = await createAnalysis({ resumeId: a.resumeId, jobDescription: a.jobDescription, forceRefresh: true });
      navigate(`/resume-analyzer/${analysis.id}`);
    } catch (err) { setRerunError(getErrorMessage(err)); }
    finally { setRerunning(false); }
  };

  return (
    <div>
      <Link to="/resume-analyzer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 hover:underline"><ArrowLeft className="size-4" aria-hidden="true" /> All analyses</Link>

      {loading && <div className="mt-6 space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-56" /><Skeleton className="h-40" /></div>}
      {error && (
        <div className="mt-6 rounded-panel border border-line bg-surface p-8">
          <EmptyState title={error.response?.status === 404 ? 'Report not found' : 'Could not load this report'}>
            {error.response?.status === 404 ? 'It may have been deleted, or it belongs to another account.' : getErrorMessage(error)}
          </EmptyState>
        </div>
      )}
      {a && (
        <>
          <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold">{a.roleTitle || 'Untitled role'}</h1>
              <p className="mt-1 text-sm text-muted">Resume: {a.resumeFilename} · {formatDateTime(a.createdAt)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(others.data?.analyses ?? []).some((x) => x.id !== id) && (
                <label className="text-sm font-semibold"><span className="sr-only">Compare with another analysis</span>
                  <select value="" onChange={(e) => e.target.value && navigate(`/resume-analyzer/compare?a=${e.target.value}&b=${id}`)} className="min-h-10 max-w-56 rounded-control border border-line bg-surface px-3 text-sm font-normal">
                    <option value="">Compare with…</option>
                    {others.data.analyses.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{(x.roleTitle || 'Untitled role')} ({x.score.overall}/100)</option>)}
                  </select>
                </label>
              )}
              <Button variant="danger" onClick={() => setConfirmOpen(true)}><Trash2 className="size-4" aria-hidden="true" /> Delete</Button>
            </div>
          </header>
          <div className="mt-4"><Alert>{rerunError}</Alert></div>
          <div className="mt-6"><ReportBody a={a} onRerun={rerun} rerunning={rerunning} /></div>
          <ConfirmDialog open={confirmOpen} title="Delete this analysis?" loading={busy} onConfirm={remove} onCancel={() => setConfirmOpen(false)}>
            This report will be permanently deleted. Your resume stays saved.
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
