import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { vi } from 'vitest';
import { retrievalOutcome, reciprocalRank, citationsValid, strongSupportRatio, abstained, summarize } from '../src/ai/evaluation/metrics.js';
import { runRagEvaluation } from '../src/ai/evaluation/runner.js';
import { LocalRetriever } from '../src/ai/rag/retriever.js';
import { UserQuota } from '../src/ai/quota.js';
import { QUESTIONS } from '../eval/dataset.js';
import { NOTES } from '../eval/corpus.js';
import { setupDb, teardownDb, clearDb } from './helpers.js';
import { ragLlm, fakeEmbedder } from './fixtures.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

describe('metrics (pure)', () => {
  const hits = [
    { filename: 'a.pdf', text: 'Something about\nPaging and frames.' },
    { filename: 'b.pdf', text: 'A LEFT JOIN returns all rows from the left table.' },
  ];
  it('finds the expected passage, whitespace/case-insensitively, with its rank', () => {
    expect(retrievalOutcome(hits, { document: 'b.pdf', snippet: 'left join returns all rows' })).toEqual({ hit: true, rank: 2 });
    expect(retrievalOutcome(hits, { document: 'a.pdf', snippet: 'paging and frames' })).toEqual({ hit: true, rank: 1 });
  });
  it('requires BOTH the right document and the right text', () => {
    expect(retrievalOutcome(hits, { document: 'a.pdf', snippet: 'left join' }).hit).toBe(false);
    expect(retrievalOutcome(hits, { document: 'b.pdf', snippet: 'deadlock' }).hit).toBe(false);
  });
  it('computes reciprocal rank', () => {
    expect([reciprocalRank(1), reciprocalRank(4), reciprocalRank(null)]).toEqual([1, 0.25, 0]);
  });
  it('detects citations that do not correspond to a retrieved source', () => {
    const ok = { sources: [{ n: 1 }, { n: 2 }], sections: [{ sources: [1, 2] }] };
    expect(citationsValid(ok)).toBe(true);
    expect(citationsValid({ ...ok, sections: [{ sources: [1, 3] }] })).toBe(false);
    expect(citationsValid({ ...ok, sections: [{ sources: [] }] })).toBe(false);
    expect(citationsValid({ sources: [], sections: [] })).toBe(true); // nothing claimed, nothing to check
  });
  it('reports support share and abstention', () => {
    expect(strongSupportRatio({ sections: [{ support: 'strong' }, { support: 'weak' }] })).toBe(0.5);
    expect(strongSupportRatio({ sections: [] })).toBeNull();
    expect(abstained({ status: 'insufficient_evidence' })).toBe(true);
    expect(abstained({ status: 'answered' })).toBe(false);
  });
  it('summarises without inventing numbers and always carries the caveats', () => {
    const s = summarize([], { k: 5 });
    expect(s.retrieval).toEqual({ k: 5, hitAtK: null, mrr: null });
    expect(s.negatives.correctlyAbstained).toBeNull();
    expect(s.caveats.join(' ')).toMatch(/too few for any accuracy claim/);
  });
});

describe('dataset', () => {
  it('has positives that point at real corpus text, and negatives with no expectation', () => {
    const corpusText = (doc) => NOTES[doc].flat().join(' ').toLowerCase().replace(/\s+/g, ' ');
    const positives = QUESTIONS.filter((q) => q.type === 'positive');
    const negatives = QUESTIONS.filter((q) => q.type === 'negative');
    expect(positives.length).toBeGreaterThanOrEqual(8);
    expect(negatives.length).toBeGreaterThanOrEqual(3);
    for (const q of positives) expect(corpusText(q.expected.document)).toContain(q.expected.snippet); // an unreachable expectation would silently lower scores
    expect(negatives.every((q) => !q.expected)).toBe(true);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });
});

describe('runRagEvaluation (pipeline mechanics with test doubles)', () => {
  const makeDeps = ({ llm = ragLlm(), retriever = new LocalRetriever(), minScore = 0 } = {}) => ({
    llm, embedder: fakeEmbedder(), retriever,
    ingestQuota: new UserQuota({ limit: 100 }), chatQuota: new UserQuota({ limit: 100 }),
    ragConfig: { topK: 3, numCandidates: 50, minScore, maxContextChars: 9000, retries: 0, retryBaseMs: 0, sleep: async () => {} },
  });
  const run = (deps) => runRagEvaluation({ userId: new mongoose.Types.ObjectId(), corpus: NOTES, questions: QUESTIONS, deps });

  it('ingests the corpus, runs every question through the real pipeline and reports consistent numbers', async () => {
    const { results, summary } = await run(makeDeps());
    expect(results).toHaveLength(QUESTIONS.length);
    expect(summary.questions).toEqual({ positive: 10, negative: 4 });

    const pos = results.filter((r) => r.type === 'positive');
    expect(summary.retrieval.hitAtK).toBeCloseTo(pos.filter((r) => r.retrieval.hit).length / pos.length, 10); // summary == per-question data
    for (const r of results) expect(r.answer).toBeTruthy();
    expect(results.filter((r) => r.type === 'negative').every((r) => r.retrieval === null)).toBe(true);
  });

  it('is SENSITIVE to retrieval quality: a retriever that returns the worst passages scores lower', async () => {
    class WorstFirst extends LocalRetriever {
      async search(args) { return (await super.search({ ...args, limit: 1000 })).reverse().slice(0, args.limit); }
    }
    const good = (await run(makeDeps())).summary.retrieval.hitAtK;
    const bad = (await run(makeDeps({ retriever: new WorstFirst() }))).summary.retrieval.hitAtK;
    expect(good).toBeGreaterThan(bad);
  });

  it('is SENSITIVE to abstention: a threshold lets negatives abstain without calling the LLM, a gullible LLM does not', async () => {
    const strict = await run(makeDeps({ minScore: 0.6 }));
    expect(strict.summary.negatives.correctlyAbstained).toBe(1); // every negative ended as "insufficient evidence"
    const negatives = strict.results.filter((r) => r.type === 'negative');
    // Layer 1 (threshold) stops most before the LLM. A question can still slip through on a chance word match
    // (n1 scores 0.604 here); then layer 2 (the model's own "sufficient: false") catches it. Both layers matter.
    expect(negatives.filter((r) => r.usedLlm === false).length).toBeGreaterThanOrEqual(3);
    expect(negatives.filter((r) => r.usedLlm).every((r) => r.status === 'insufficient_evidence')).toBe(true);

    const gullible = ragLlm();
    gullible.generate = vi.fn(async () => ({ text: JSON.stringify({ sufficient: true, sections: [{ text: 'It works by scheduling things onto nodes.', sources: [1] }], limitations: '' }), finishReason: 'STOP', usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 } }));
    const naive = await run(makeDeps({ llm: gullible, minScore: 0 }));
    expect(naive.summary.negatives.correctlyAbstained).toBe(0); // it answered questions the notes cannot answer: the metric catches it
    expect(naive.summary.answers.strongSupport).toBeLessThan(1); // and its invented text is weakly supported by the cited passage
  });

  it('fails with a clear message if ingestion fails, instead of reporting scores', async () => {
    const deps = makeDeps();
    deps.embedder.embed.mockRejectedValue(new Error('boom'));
    await expect(run(deps)).rejects.toThrow(/Ingestion failed for/);
  });
});
