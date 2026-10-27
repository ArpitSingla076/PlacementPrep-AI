/**
 * THE SCORING RUBRIC - the only place scoring numbers live.
 * Everything here is deterministic and shown to the user, so a score can always be explained:
 *   score = 100 * sum(weight * credit) / sum(weight)
 */
export const RUBRIC_VERSION = 'rubric@1';

// How much each job requirement matters, taken from the job description's own wording.
export const IMPORTANCE_WEIGHT = { required: 3, preferred: 2, bonus: 1 };

// How much of a requirement's weight the resume earns, depending on the evidence found.
export const EVIDENCE_CREDIT = { demonstrated: 1, listed: 0.5, inferred: 0.25, none: 0 };

export const IMPORTANCE_ORDER = ['required', 'preferred', 'bonus'];

export function describeRubric() {
  return {
    version: RUBRIC_VERSION,
    formula: 'score = 100 x (sum of weight x credit) / (sum of weights)',
    weights: [
      { key: 'required', weight: IMPORTANCE_WEIGHT.required, meaning: 'The job description presents it as a requirement (must have, required, you will need).' },
      { key: 'preferred', weight: IMPORTANCE_WEIGHT.preferred, meaning: 'Described as preferred or strongly desired.' },
      { key: 'bonus', weight: IMPORTANCE_WEIGHT.bonus, meaning: 'Described as a nice-to-have or bonus.' },
    ],
    credits: [
      { key: 'demonstrated', credit: EVIDENCE_CREDIT.demonstrated, meaning: 'Named in your resume AND shown in use (a project, job or achievement). The quote is checked against your resume text.' },
      { key: 'listed', credit: EVIDENCE_CREDIT.listed, meaning: 'Named in your resume but only listed (for example in a skills list), with no example of using it.' },
      { key: 'inferred', credit: EVIDENCE_CREDIT.inferred, meaning: 'Not named, but related work suggests it. This is the AI\'s inference, so it earns little credit.' },
      { key: 'none', credit: EVIDENCE_CREDIT.none, meaning: 'No supporting evidence found in the resume text.' },
    ],
    notes: [
      'The AI reads and classifies; this arithmetic is done by code, so the model cannot choose the score.',
      'Every piece of evidence must be a quote that exists in your resume. Claims we could not verify are scored as no evidence.',
      '"Demonstrated" versus "listed" is the AI\'s judgement. Whether a skill is named at all is checked by code.',
      'The score is an estimate of how well your resume text covers this job description. It is not a hiring probability.',
    ],
  };
}
