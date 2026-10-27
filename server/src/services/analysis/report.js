import { describeRubric } from './rubric.js';

const byWeightDesc = (a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill);

const slim = (r) => ({
  skill: r.skill, category: r.category, importance: r.importance, weight: r.weight,
  evidenceLevel: r.evidenceLevel, claimedLevel: r.claimedLevel, credit: r.credit,
  verification: r.verification, matchedTerm: r.matchedTerm, evidenceQuote: r.evidenceQuote, note: r.note,
});

export const DISCLAIMER =
  'This match score is an estimate of how well your resume text covers this job description. It is not a hiring probability, and AI-generated findings can be wrong. Review everything before acting on it.';

/** Full report for one analysis. The three skill groups are DERIVED from the single `requirements` list. */
export function toReport(doc) {
  const reqs = doc.requirements.map(slim);
  const group = (levels) => reqs.filter((r) => levels.includes(r.evidenceLevel)).sort(byWeightDesc);
  return {
    id: doc._id.toString(),
    resumeId: doc.resumeId.toString(),
    resumeFilename: doc.resumeFilename,
    roleTitle: doc.roleTitle,
    jobDescription: doc.jobDescription,
    createdAt: doc.createdAt,
    score: doc.score,
    skills: {
      demonstrated: group(['demonstrated']),
      needsEvidence: group(['listed', 'inferred']),
      missing: group(['none']),
    },
    relevantHighlights: doc.relevantHighlights,
    resumeGaps: doc.resumeGaps,
    // Anything that adds a skill the resume does not establish must be verified by the user first.
    suggestions: doc.suggestions.map((s) => ({ ...s.toObject?.() ?? s, needsUserVerification: s.type === 'conditional_add' })),
    preparationChecklist: doc.preparationChecklist,
    interviewTopics: doc.interviewTopics,
    interviewQuestions: doc.interviewQuestions,
    ai: doc.ai,
    rubric: describeRubric(),
    disclaimer: DISCLAIMER,
  };
}

/** Compact row for history lists and the dashboard. */
export function toSummary(doc) {
  return {
    id: doc._id.toString(),
    resumeId: doc.resumeId.toString(),
    resumeFilename: doc.resumeFilename,
    roleTitle: doc.roleTitle,
    createdAt: doc.createdAt,
    score: { overall: doc.score?.overall ?? 0, counts: doc.score?.counts },
  };
}
