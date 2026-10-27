/**
 * Deterministic "embedding" for TESTS ONLY: hashes words into buckets (bag of words) and normalises.
 * Texts sharing words get high cosine similarity, which is enough to test retrieval MECHANICS (ranking, filtering,
 * isolation). It says nothing about the quality of real Gemini embeddings.
 */
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'and', 'what', 'how', 'does', 'do', 'for', 'on', 'it', 'its', 'as', 'by', 'with', 'that', 'this', 'or']);

export function hashEmbed(text, dims = 512) {
  const v = new Array(dims).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(w)) continue;
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
