/**
 * Lexical "support" heuristic: what fraction of an answer sentence's content words appear in the passages it cites?
 *
 * It is a cheap SIGNAL, not proof. A paraphrase can score low although it is correct, and a sentence can reuse words
 * from a passage while saying something different. We use it to label sections "weak support: verify in the source",
 * never to silently drop or approve an answer. Documented limitation (README, RAG evaluation).
 */
const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'were', 'will', 'which', 'their', 'there', 'than', 'then', 'them', 'also',
  'into', 'when', 'what', 'where', 'while', 'such', 'these', 'those', 'about', 'because', 'each', 'other', 'some', 'more', 'most', 'only', 'very',
  'does', 'used', 'using', 'can', 'could', 'would', 'should', 'being', 'both', 'after', 'before', 'over', 'under', 'between']);

const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w));
const stem = (w) => w.slice(0, 5); // crude: "indexes"/"indexing"/"index" share a stem

export function supportScore(sectionText, citedTexts) {
  const target = words(sectionText).map(stem);
  if (target.length === 0) return 1; // nothing checkable (very short or all stop words)
  const pool = new Set(citedTexts.flatMap(words).map(stem));
  return target.filter((w) => pool.has(w)).length / target.length;
}

export const WEAK_SUPPORT_BELOW = 0.4;
