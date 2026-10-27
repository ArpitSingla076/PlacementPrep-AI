/**
 * The deterministic half of the preparation plan: WHICH items exist, their priority and the evidence behind them.
 * Pure functions over saved results. The model never decides any of this.
 */
export const WEAK_BELOW = 60; // average interview score (0..100) under which a topic counts as weak
export const MIN_ATTEMPTS = 2; // answers needed before we call a topic a weakness (one low score is not a pattern)
export const MAX_ITEMS = 12;

const rank = { high: 0, medium: 1, low: 2 };

/**
 * sessions: [{ _id, questions: [{ topic, topicKey, evaluation? }] }]  ->  Map(topicKey -> stats)
 * sessionsBelow counts DIFFERENT interviews in which the topic's average was weak: "repeated weakness".
 */
export function topicStats(sessions) {
  const stats = new Map();
  for (const s of sessions) {
    const perSession = new Map();
    for (const q of s.questions) {
      if (!q.evaluation) continue;
      const t = stats.get(q.topicKey) ?? { topic: q.topic, topicKey: q.topicKey, scores: [], sessionsBelow: 0, sessions: 0 };
      t.scores.push(q.evaluation.overall);
      stats.set(q.topicKey, t);
      perSession.set(q.topicKey, [...(perSession.get(q.topicKey) ?? []), q.evaluation.overall]);
    }
    for (const [key, xs] of perSession) {
      const t = stats.get(key);
      t.sessions += 1;
      if (xs.reduce((a, b) => a + b, 0) / xs.length < WEAK_BELOW) t.sessionsBelow += 1;
    }
  }
  return new Map([...stats].map(([k, t]) => [k, { ...t, attempts: t.scores.length, average: Math.round(t.scores.reduce((a, b) => a + b, 0) / t.scores.length) }]));
}

export function interviewItems(stats) {
  const items = [];
  for (const t of stats.values()) {
    if (t.average >= WEAK_BELOW) continue;
    const observed = { attempts: t.attempts, average: t.average, sessions: t.sessions, sessionsBelowThreshold: t.sessionsBelow, recentScores: t.scores.slice(-5) };
    if (t.attempts < MIN_ATTEMPTS) {
      // Observed once. We report it, but do NOT call it a weakness.
      items.push({ key: `watch:${t.topicKey}`, kind: 'watch', topic: t.topic, priority: 'low', evidenceType: 'limited_evidence', observed,
        reason: `You scored ${t.average}/100 on your only answer about "${t.topic}". One answer is not enough to call it a weakness, so practise it once more to find out.` });
      continue;
    }
    const repeated = t.sessionsBelow >= 2;
    const priority = t.average < 40 || repeated ? 'high' : 'medium';
    items.push({ key: `weak_topic:${t.topicKey}`, kind: 'weak_topic', topic: t.topic, priority, evidenceType: 'observed_performance', observed,
      reason: `Your average on "${t.topic}" is ${t.average}/100 across ${t.attempts} answers${t.sessions > 1 ? ` in ${t.sessions} interviews` : ''}${repeated ? `, and it was below ${WEAK_BELOW} in ${t.sessionsBelow} different interviews (a repeated weakness)` : ''}.` });
  }
  return items;
}

/** analysis.requirements: [{ skill, importance, weight, evidenceLevel, credit }] */
export function analysisItems(analysis) {
  if (!analysis) return [];
  const scored = analysis.requirements
    .filter((r) => r.credit < 1)
    .map((r) => {
      const priority = r.importance === 'required' ? (r.evidenceLevel === 'none' ? 'high' : 'medium') : 'low';
      const state = { none: 'no evidence of it', listed: 'it is only listed, with no example of using it', inferred: 'it is only implied by related work' }[r.evidenceLevel];
      return {
        impact: r.weight * (1 - r.credit), // how much score is at stake: used only to order and cut the list
        item: {
          key: `skill_gap:${r.skill.toLowerCase().trim()}`, kind: 'skill_gap', topic: r.skill, priority, evidenceType: 'resume_analysis',
          observed: { importance: r.importance, evidenceLevel: r.evidenceLevel, credit: r.credit },
          reason: `The job description treats "${r.skill}" as ${r.importance}, and your resume shows ${state}.`,
        },
      };
    });
  return scored.sort((x, y) => y.impact - x.impact).slice(0, 8).map((x) => x.item);
}

export function buildItems({ stats, analysis }) {
  const merged = new Map();
  for (const it of [...interviewItems(stats), ...analysisItems(analysis)]) {
    // The same topic may appear as both an interview weakness and a resume gap: keep both, they are different evidence.
    merged.set(it.key, it);
  }
  return [...merged.values()].sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, MAX_ITEMS);
}

/**
 * Carry completion forward when the plan is regenerated. A ticked item is REOPENED if new answers on that topic have
 * arrived since and the topic is still weak: finishing a revision task does not erase fresh evidence.
 */
export function carryCompletion(newItems, previousItems) {
  const prev = new Map(previousItems.map((p) => [p.key, p]));
  return newItems.map((it) => {
    const p = prev.get(it.key);
    if (!p?.completed) return it;
    const attemptsNow = it.observed?.attempts;
    if (it.kind === 'weak_topic' && attemptsNow > (p.completedAtAttempts ?? 0)) {
      return { ...it, completed: false, reopenedNote: `Reopened: you answered ${attemptsNow - (p.completedAtAttempts ?? 0)} more question(s) on this topic after ticking it off, and it is still below ${WEAK_BELOW}.` };
    }
    return { ...it, completed: true, completedAt: p.completedAt, completedAtAttempts: p.completedAtAttempts };
  });
}
