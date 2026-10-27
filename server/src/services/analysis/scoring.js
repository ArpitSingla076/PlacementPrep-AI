import { IMPORTANCE_WEIGHT, IMPORTANCE_ORDER, RUBRIC_VERSION } from './rubric.js';
import { verifyRequirement, normalizeForMatch, normalizeSkillKey, creditFor, UNVERIFIED } from './evidence.js';

const pct = (earned, possible) => (possible === 0 ? 0 : Math.round((earned / possible) * 100));

/** The LLM may list the same skill twice ("Java" / "java"). Merge them, keeping the most important and the best evidence. */
export function dedupeRequirements(reqs) {
  const byKey = new Map();
  const levelRank = { none: 0, inferred: 1, listed: 2, demonstrated: 3 };
  for (const r of reqs) {
    const key = normalizeSkillKey(r.skill);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, { ...r }); continue; }
    if (IMPORTANCE_WEIGHT[r.importance] > IMPORTANCE_WEIGHT[existing.importance]) existing.importance = r.importance;
    if (levelRank[r.evidenceLevel] > levelRank[existing.evidenceLevel]) {
      Object.assign(existing, { evidenceLevel: r.evidenceLevel, evidenceQuote: r.evidenceQuote, matchedTerm: r.matchedTerm, note: r.note });
    }
  }
  return [...byKey.values()];
}

/**
 * Pure function: (model's classified requirements, the resume text the model saw) -> verified requirements + score.
 * No randomness, no network, no model. Same input always gives the same score.
 */
export function evaluateRequirements(rawRequirements, resumeTextSentToModel) {
  const resumeNormalized = normalizeForMatch(resumeTextSentToModel);
  const requirements = dedupeRequirements(rawRequirements).map((r) => {
    const verified = verifyRequirement(r, resumeNormalized);
    return { ...verified, weight: IMPORTANCE_WEIGHT[verified.importance], credit: creditFor(verified.evidenceLevel) };
  });

  const totals = (items) => items.reduce((a, r) => ({ earned: a.earned + r.weight * r.credit, possible: a.possible + r.weight }), { earned: 0, possible: 0 });
  const all = totals(requirements);

  const group = (keyFn, keys) =>
    keys
      .map((key) => {
        const items = requirements.filter((r) => keyFn(r) === key);
        const t = totals(items);
        return { key, count: items.length, earned: round2(t.earned), possible: t.possible, percent: pct(t.earned, t.possible) };
      })
      .filter((g) => g.count > 0);

  const categories = [...new Set(requirements.map((r) => r.category))];
  const countLevel = (l) => requirements.filter((r) => r.evidenceLevel === l).length;

  return {
    requirements,
    score: {
      overall: pct(all.earned, all.possible),
      earned: round2(all.earned),
      possible: all.possible,
      rubricVersion: RUBRIC_VERSION,
      byImportance: group((r) => r.importance, IMPORTANCE_ORDER),
      byCategory: group((r) => r.category, categories),
      counts: {
        total: requirements.length,
        demonstrated: countLevel('demonstrated'),
        listed: countLevel('listed'),
        inferred: countLevel('inferred'),
        none: countLevel('none'),
        // claims the model made that we could not verify against the resume
        unverifiedClaims: requirements.filter((r) => UNVERIFIED.has(r.verification)).length,
        downgraded: requirements.filter((r) => r.verification === 'term_not_in_quote').length,
      },
    },
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Checklist priority comes from the rubric (how heavy the requirement is and how big the gap is),
 * NOT from the model. The model only supplies the text of the task.
 */
export function prioritizeChecklist(items, requirements) {
  const byKey = new Map(requirements.map((r) => [normalizeSkillKey(r.skill), r]));
  const rank = { high: 0, medium: 1, low: 2 };
  const scored = items.map((item) => {
    const req = byKey.get(normalizeSkillKey(item.relatedSkill));
    const gap = req ? 1 - req.credit : 0;
    let priority = 'low';
    if (req?.importance === 'required' && gap >= 0.75) priority = 'high';
    else if ((req?.importance === 'required' && gap > 0) || (req?.importance === 'preferred' && gap >= 0.75)) priority = 'medium';
    return { item: { ...item, priority }, rank: rank[priority], impact: req ? req.weight * gap : 0 };
  });
  // Sort by priority, then by how much score is at stake. The helper fields never leak into the result.
  return scored.sort((a, b) => a.rank - b.rank || b.impact - a.impact).map((s) => s.item);
}
