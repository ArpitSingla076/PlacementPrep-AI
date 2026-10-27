/**
 * Simple, explainable RAG metrics. Every function is pure and documented with what it does NOT tell you.
 */
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');

/** Did retrieval return a passage from the expected document that contains the expected snippet? Rank is 1-based. */
export function retrievalOutcome(hits, expected) {
  const idx = hits.findIndex((h) => h.filename === expected.document && norm(h.text).includes(norm(expected.snippet)));
  return { hit: idx !== -1, rank: idx === -1 ? null : idx + 1 };
}

/** 1/rank of the first correct passage (0 if none). Averaged over questions this is MRR. */
export const reciprocalRank = (rank) => (rank ? 1 / rank : 0);

/** Every number cited in an answer must be one of the sources that were actually retrieved and sent to the model. */
export function citationsValid(message) {
  const sent = new Set((message.sources ?? []).map((s) => s.n));
  return (message.sections ?? []).every((sec) => sec.sources.length > 0 && sec.sources.every((n) => sent.has(n)));
}

/** Share of answer sections whose wording is lexically supported by their cited passages (see ai/rag/support.js: a heuristic). */
export function strongSupportRatio(message) {
  const secs = message.sections ?? [];
  return secs.length ? secs.filter((s) => s.support === 'strong').length / secs.length : null;
}

/** For a question whose answer is absent: did the system decline to answer? */
export const abstained = (message) => message.status === 'insufficient_evidence';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (xs) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

export function summarize(results, { k }) {
  const pos = results.filter((r) => r.type === 'positive');
  const neg = results.filter((r) => r.type === 'negative');
  const answered = pos.filter((r) => r.status === 'answered');
  return {
    questions: { positive: pos.length, negative: neg.length },
    retrieval: { k, hitAtK: rate(pos.map((r) => r.retrieval.hit)), mrr: mean(pos.map((r) => reciprocalRank(r.retrieval.rank))) },
    answers: {
      answeredShare: rate(pos.map((r) => r.status === 'answered')), // positives where the system did answer
      citationsValid: rate(answered.map((r) => r.citationsValid)),
      strongSupport: mean(answered.map((r) => r.strongSupport).filter((x) => x !== null)),
    },
    negatives: { correctlyAbstained: rate(neg.map((r) => r.abstained)) },
    caveats: [
      `Measured on ${pos.length} positive and ${neg.length} negative questions: too few for any accuracy claim. Use it to compare settings and spot failures.`,
      'Retrieval hit = a retrieved passage contains the expected snippet. It does not check that the final answer is correct.',
      'Support is a lexical-overlap heuristic: paraphrases can score low and reused words can score high. Read answers yourself.',
    ],
  };
}
