import { EVIDENCE_CREDIT } from './rubric.js';

/**
 * Evidence verification: the anti-hallucination step.
 * The model must quote the resume. We check, in code, that the quote really exists in the text we sent,
 * and that the skill term it claims to have matched really appears inside that quote.
 */

/** Lowercase, drop punctuation but keep tokens like c++, c#, node.js; collapse whitespace. */
export function normalizeForMatch(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, '')) // sentence-final "." is not part of a token ("Express." -> "express")
    .filter(Boolean)
    .join(' ');
}

/** Whole-word containment, so "java" does NOT match inside "javascript". */
export function containsPhrase(haystackNormalized, needle) {
  const n = normalizeForMatch(needle);
  if (!n) return false;
  return ` ${haystackNormalized} `.includes(` ${n} `);
}

export function normalizeSkillKey(skill) {
  return normalizeForMatch(skill);
}

/**
 * Returns the requirement with a verified (possibly downgraded) evidence level.
 * claimedLevel is preserved so the UI can show "unverified claims removed".
 */
export function verifyRequirement(req, resumeNormalized) {
  const claimedLevel = req.evidenceLevel;
  const base = { ...req, claimedLevel, evidenceQuote: req.evidenceQuote?.trim() ?? '', matchedTerm: req.matchedTerm?.trim() ?? '' };

  if (claimedLevel === 'none') return { ...base, evidenceLevel: 'none', verification: 'no_evidence_claimed' };

  const quoteFound = base.evidenceQuote.length > 0 && containsPhrase(resumeNormalized, base.evidenceQuote);
  if (!quoteFound) {
    // The model claimed evidence but the quote is missing or not in the resume => treat as hallucinated.
    return { ...base, evidenceLevel: 'none', verification: base.evidenceQuote ? 'quote_not_found' : 'quote_missing' };
  }

  if (claimedLevel === 'demonstrated' || claimedLevel === 'listed') {
    const termOk = base.matchedTerm.length > 0 && containsPhrase(normalizeForMatch(base.evidenceQuote), base.matchedTerm);
    if (!termOk) {
      // Real quote, but the skill is not literally named in it: that is inference, not explicit evidence.
      return { ...base, evidenceLevel: 'inferred', verification: 'term_not_in_quote' };
    }
  }
  return { ...base, evidenceLevel: claimedLevel, verification: 'verified' };
}

export const UNVERIFIED = new Set(['quote_not_found', 'quote_missing']);

export function creditFor(level) {
  return EVIDENCE_CREDIT[level] ?? 0;
}
