import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, ShieldAlert, SearchX } from 'lucide-react';
import { Badge } from './ui/Badge.jsx';
import { Button } from './ui/Button.jsx';

const pages = (s) => (s.pageStart === s.pageEnd ? `page ${s.pageStart}` : `pages ${s.pageStart}-${s.pageEnd}`);

/** Native <dialog>: shows exactly which passage, in which document and page, a citation points to. */
function SourceDialog({ source, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (source && !d.open) d.showModal();
    if (!source && d.open) d.close();
  }, [source]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="source-title" className="m-auto w-[min(36rem,94vw)] rounded-panel border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-navy-950/50">
      {source && (
        <>
          <h2 id="source-title" className="flex items-center gap-2 text-base font-bold"><BookMarked className="size-4 text-navy-700" aria-hidden="true" /> Source [{source.n}]</h2>
          <p className="mt-1 text-sm text-muted">{source.filename} · {pages(source)}</p>
          {source.documentDeleted
            ? <p className="mt-4 rounded-control bg-navy-50 p-3 text-sm text-muted">This document was deleted, so the quoted passage is no longer stored.</p>
            : <blockquote className="mt-4 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-control border-l-2 border-navy-700 bg-navy-50 p-3 text-sm leading-relaxed">{source.text}</blockquote>}
          <div className="mt-5 flex items-center justify-between">
            {!source.documentDeleted ? <Link to="/documents" className="text-sm font-semibold text-navy-800 underline underline-offset-4">Open Documents</Link> : <span />}
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </>
      )}
    </dialog>
  );
}

/** One assistant reply. Each answer sentence carries clickable [n] citations that open the exact passage. */
export function AnswerMessage({ message }) {
  const [open, setOpen] = useState(null);
  const byN = new Map(message.sources.map((s) => [s.n, s]));
  const cited = message.sources.filter((s) => s.cited);
  const others = message.sources.filter((s) => !s.cited);

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      {message.status === 'insufficient_evidence' ? (
        <div className="flex items-start gap-3">
          <SearchX className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-bold">Not found in your notes</p>
            <p className="mt-1 text-muted">{message.limitations}</p>
            <p className="mt-2 text-xs text-muted">The assistant only answers from your uploaded documents, so it won&apos;t guess. Try rephrasing, or upload notes that cover this topic.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {message.sections.map((s, i) => (
            <p key={i} className="text-sm leading-relaxed">
              {s.text}{' '}
              {s.sources.map((n) => (
                <button key={n} type="button" onClick={() => setOpen(byN.get(n))} aria-label={`Open source ${n}`}
                  className="mx-0.5 inline-flex min-w-6 items-center justify-center rounded-md bg-navy-100 px-1.5 text-xs font-bold text-navy-800 hover:bg-navy-700 hover:text-white">[{n}]</button>
              ))}
              {s.support === 'weak' && <span className="ml-1 inline-flex items-center gap-1 align-middle text-xs font-medium text-warn"><ShieldAlert className="size-3.5" aria-hidden="true" />weak match, verify in the source</span>}
            </p>
          ))}
          {message.limitations && <p className="rounded-control bg-warn-bg p-2.5 text-xs text-warn">{message.limitations}</p>}
        </div>
      )}

      {cited.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Sources</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {cited.map((s) => (
              <li key={s.n}><button type="button" onClick={() => setOpen(s)} className="rounded-control border border-line px-2.5 py-1.5 text-left text-xs hover:bg-navy-50"><strong>[{s.n}]</strong> {s.filename}, {pages(s)}</button></li>
            ))}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer font-semibold">Also searched ({others.length} passage{others.length === 1 ? '' : 's'} not used)</summary>
          <ul className="mt-2 flex flex-wrap gap-2">{others.map((s) => <li key={s.n}><button type="button" onClick={() => setOpen(s)} className="rounded-control border border-line px-2 py-1 hover:bg-navy-50">{s.filename}, {pages(s)}</button></li>)}</ul>
        </details>
      )}
      {message.ai?.model && <p className="mt-3 text-[11px] text-muted">{message.ai.usedLlm ? `Answered by ${message.ai.model} from retrieved passages` : 'No model call: nothing relevant was retrieved'}</p>}
      {message.status === 'answered' && <p className="sr-only"><Badge>answered</Badge></p>}
      <SourceDialog source={open} onClose={() => setOpen(null)} />
    </div>
  );
}
