import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquarePlus, Send, Trash2, Loader2, BookOpenCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { getAiStatus } from '../services/aiService.js';
import { listDocuments } from '../services/documentService.js';
import { askQuestion, listConversations, getConversation, deleteConversation } from '../services/chatService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { AnswerMessage } from '../components/AnswerMessage.jsx';
import { ConsentCard } from '../components/ConsentCard.jsx';
import { SetupNotice, Code } from '../components/SetupNotice.jsx';
import { getErrorMessage } from '../utils/errors.js';

// Starting points only: the assistant answers from YOUR notes, and says so when they don't cover a question.
const SUGGESTIONS = [
  'What is the difference between an INNER JOIN and a LEFT JOIN?',
  'What are the four conditions required for a deadlock?',
  'Explain third normal form.',
  'How does paging avoid external fragmentation?',
  'Describe the TCP three way handshake.',
];

export default function AssistantPage() {
  const { user } = useAuth();
  const toast = useToast();
  const consent = user.preferences?.aiDataConsent?.given === true;
  const status = useFetch(getAiStatus, [consent]);
  const docs = useFetch(() => listDocuments(1, 50), []);
  const convs = useFetch(() => listConversations(1, 30), []);
  const [thread, setThread] = useState({ id: null, messages: [] });
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState([]); // selected document ids; empty = all ready documents
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const ready = (docs.data?.documents ?? []).filter((d) => d.status === 'ready');
  const ai = status.data;
  const configured = ai?.configured && ai?.embedding?.configured;
  const canAsk = consent && configured && ready.length > 0 && question.trim().length >= 3 && !asking;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [thread.messages.length, asking]);

  const send = async (text) => {
    const q = (text ?? question).trim();
    if (q.length < 3) return;
    setAsking(true); setError('');
    setThread((t) => ({ ...t, messages: [...t.messages, { role: 'user', content: q, _pending: true }] }));
    setQuestion('');
    try {
      const { conversationId, message } = await askQuestion({ question: q, conversationId: thread.id ?? undefined, documentIds: scope.length ? scope : undefined });
      setThread((t) => ({ id: conversationId, messages: [...t.messages.map((m) => ({ ...m, _pending: false })), message] }));
      convs.reload(); status.reload();
    } catch (err) {
      setThread((t) => ({ ...t, messages: t.messages.filter((m) => !m._pending) }));
      setQuestion(q); // keep the text so nothing is lost
      setError(getErrorMessage(err));
    } finally { setAsking(false); }
  };

  const open = async (id) => {
    setError('');
    try { const c = await getConversation(id); setThread({ id: c.id, messages: c.messages }); }
    catch (err) { toast.error(getErrorMessage(err)); }
  };
  const remove = async (id) => {
    try { await deleteConversation(id); if (thread.id === id) setThread({ id: null, messages: [] }); convs.reload(); }
    catch (err) { toast.error(getErrorMessage(err)); }
  };
  const toggleScope = (id) => setScope((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Technical AI Assistant</h1>
      <p className="mt-2 flex max-w-2xl items-start gap-2 text-muted"><BookOpenCheck className="mt-0.5 size-5 shrink-0 text-navy-700" aria-hidden="true" />Answers are grounded in the notes you uploaded, with a citation for each statement. If your notes don&apos;t cover a question, the assistant says so instead of guessing.</p>

      <div className="mt-6 space-y-4">
        {ai && !configured && (
          <SetupNotice title="The assistant is not set up on this server yet">
            <p>The site owner needs <Code>GEMINI_API_KEY</Code>, <Code>LLM_MODEL</Code> and <Code>EMBEDDING_MODEL</Code> in <Code>server/.env</Code>{ai.knowledge?.vectorSearchMode === 'atlas' && <>, plus the Atlas vector index (<Code>npm run vector:index</Code>)</>}. Run <Code>npm run ai:check</Code> to verify.</p>
          </SetupNotice>
        )}
        {!consent && <ConsentCard title="Before you use the assistant">Your question and the most relevant passages from your notes are sent to the AI provider (Google Gemini) to write each answer. Your PDF files are never sent whole.</ConsentCard>}
        {docs.data && ready.length === 0 && consent && (
          <div className="rounded-panel border border-line bg-surface p-5 text-sm">You need at least one ready document first. <Link to="/documents" className="font-semibold text-navy-800 underline underline-offset-4">Upload your notes</Link>.</div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside aria-label="Conversations" className="space-y-3">
          <Button variant="secondary" className="w-full" onClick={() => { setThread({ id: null, messages: [] }); setError(''); }}><MessageSquarePlus className="size-4" aria-hidden="true" /> New conversation</Button>
          {convs.loading && <Skeleton className="h-24" />}
          {convs.data?.conversations.length === 0 && <p className="px-1 text-xs text-muted">Your conversations will appear here.</p>}
          <ul className="space-y-1">
            {convs.data?.conversations.map((c) => (
              <li key={c.id} className={`group flex items-center rounded-control ${thread.id === c.id ? 'bg-navy-50' : 'hover:bg-navy-50'}`}>
                <button type="button" onClick={() => open(c.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm" aria-current={thread.id === c.id}>{c.title}</button>
                <button type="button" onClick={() => remove(c.id)} aria-label={`Delete conversation ${c.title}`} className="p-2 text-muted hover:text-bad"><Trash2 className="size-3.5" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </aside>

        <section aria-label="Conversation" className="min-w-0">
          <div className="min-h-64 space-y-4" aria-live="polite">
            {thread.messages.length === 0 && (
              <div className="rounded-panel border border-line bg-surface p-6">
                <p className="text-sm font-bold">Try a question</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => <li key={s}><button type="button" disabled={!canAsk && !(consent && configured && ready.length)} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-xs hover:bg-navy-50 disabled:opacity-50">{s}</button></li>)}
                </ul>
                <p className="mt-3 text-xs text-muted">Suggestions are generic. You&apos;ll get an answer only if your uploaded notes cover the topic.</p>
              </div>
            )}
            {thread.messages.map((m, i) => m.role === 'user'
              ? <div key={m._id ?? i} className="ml-auto max-w-[85%] rounded-card bg-navy-900 px-4 py-3 text-sm text-white">{m.content}</div>
              : <AnswerMessage key={m._id ?? i} message={m} />)}
            {asking && <div className="flex items-center gap-2 text-sm text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Searching your notes and writing an answer…</div>}
            <div ref={endRef} />
          </div>

          <div className="mt-4"><Alert>{error}</Alert></div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mt-4 rounded-card border border-line bg-surface p-3">
            {ready.length > 1 && (
              <fieldset className="mb-2 flex flex-wrap items-center gap-2 text-xs"><legend className="sr-only">Search in</legend>
                <span className="font-semibold text-muted">Search in:</span>
                {ready.map((d) => <label key={d.id} className={`cursor-pointer rounded-full border px-2.5 py-1 ${scope.includes(d.id) ? 'border-navy-700 bg-navy-50 font-semibold' : 'border-line'}`}><input type="checkbox" className="sr-only" checked={scope.includes(d.id)} onChange={() => toggleScope(d.id)} />{d.filename}</label>)}
                {scope.length === 0 && <span className="text-muted">all documents</span>}
              </fieldset>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor="q" className="sr-only">Your question</label>
              <textarea id="q" rows={2} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your notes…"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canAsk) send(); } }}
                className="block max-h-40 min-h-11 flex-1 resize-y rounded-control border border-line p-2.5 text-sm" />
              <Button type="submit" disabled={!canAsk} loading={asking} aria-label="Send question"><Send className="size-4" aria-hidden="true" /></Button>
            </div>
            {ai?.knowledge && <p className="mt-2 text-[11px] text-muted">{ai.knowledge.questions.remaining} of {ai.knowledge.questions.limit} questions left this hour. Enter to send, Shift+Enter for a new line.</p>}
          </form>
        </section>
      </div>
    </div>
  );
}
