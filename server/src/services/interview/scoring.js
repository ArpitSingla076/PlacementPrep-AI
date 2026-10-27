/**
 * Deterministic interview scoring. The model supplies judgements (per-point coverage, three 0-5 ratings);
 * everything below is plain arithmetic, so the same judgements always give the same score.
 *   overall = 100 * (0.40 * correctness + 0.30 * completeness + 0.15 * relevance + 0.15 * clarity) / 5
 * Answer LENGTH is not an input anywhere, so padding cannot raise a score.
 */
export const SCORING_VERSION = 'interview-scoring@1';
export const WEIGHTS = { correctness: 0.4, completeness: 0.3, relevance: 0.15, clarity: 0.15 };

export function computeScores({ coveredPoints, keyPointCount, correctness, relevance, clarity }) {
  const covered = Array.from({ length: keyPointCount }, (_, i) => coveredPoints[i] === true); // align, pad/truncate
  const completeness = keyPointCount ? Math.round((5 * covered.filter(Boolean).length) / keyPointCount) : 0;
  // A model sometimes awards high correctness to an answer that states none of the expected ideas. Cap it.
  const cappedCorrectness = covered.filter(Boolean).length === 0 && correctness > 1;
  const c = cappedCorrectness ? 1 : correctness;
  const overall = Math.round((100 * (WEIGHTS.correctness * c + WEIGHTS.completeness * completeness + WEIGHTS.relevance * relevance + WEIGHTS.clarity * clarity)) / 5);
  return { covered, scores: { correctness: c, completeness, relevance, clarity }, overall, cappedCorrectness };
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

export function aggregate(questions) {
  const answered = questions.filter((q) => q.evaluation);
  const dim = (k) => avg(answered.map((q) => q.evaluation.scores[k]));
  const topics = new Map();
  for (const q of answered) {
    const t = topics.get(q.topicKey) ?? { topic: q.topic, topicKey: q.topicKey, sum: 0, count: 0 };
    t.sum += q.evaluation.overall; t.count += 1; topics.set(q.topicKey, t);
  }
  return {
    answered: answered.length,
    average: Math.round(avg(answered.map((q) => q.evaluation.overall))),
    byDimension: { correctness: dim('correctness'), completeness: dim('completeness'), relevance: dim('relevance'), clarity: dim('clarity') },
    byTopic: [...topics.values()].map((t) => ({ topic: t.topic, topicKey: t.topicKey, average: Math.round(t.sum / t.count), count: t.count })),
  };
}
