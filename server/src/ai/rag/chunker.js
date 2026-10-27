/**
 * Page-aware text chunking for RAG.
 *
 * Why chunk at all: an embedding represents ONE passage's meaning. A whole 50-page PDF as one vector would match
 * nothing specifically, and we could not cite a page. Small overlapping chunks let retrieval return the exact passage.
 * Overlap stops a sentence that straddles a boundary from being lost.
 *
 * Output: [{ text, pageStart, pageEnd }] with 1-based page numbers. Deterministic: same input -> same chunks.
 */
const BREAKS = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '];

function pageAt(offsets, pos) {
  // offsets[i] = character offset where page i+1 starts. Binary search for the last start <= pos.
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

function snapEnd(text, start, end, minEnd) {
  // Prefer to end a chunk at a natural boundary inside the last quarter of the window.
  for (const b of BREAKS) {
    const idx = text.lastIndexOf(b, end - 1);
    if (idx >= minEnd) return idx + b.length;
  }
  return end;
}

export function chunkPages(pages, { size = 1200, overlap = 200, minChars = 30 } = {}) {
  if (overlap >= size / 2) throw new Error('overlap must be less than half of size');
  const offsets = [];
  let full = '';
  pages.forEach((p, i) => {
    if (i) full += '\n\n'; // pages are joined by a blank line
    offsets.push(full.length); // this page's text starts here
    full += p;
  });

  const chunks = [];
  let start = 0;
  while (start < full.length) {
    let end = Math.min(start + size, full.length);
    if (end < full.length) end = snapEnd(full, start, end, start + Math.floor(size * 0.75));

    const raw = full.slice(start, end);
    const text = raw.trim();
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length >= minChars) {
      const lead = raw.length - raw.trimStart().length;
      const firstPos = start + lead;
      const lastPos = start + lead + text.length - 1;
      chunks.push({ text, pageStart: pageAt(offsets, firstPos), pageEnd: pageAt(offsets, lastPos) });
    }
    if (end >= full.length) break;

    // Next window starts `overlap` characters back, moved forward to a word boundary so we never start mid-word.
    let next = Math.max(start + 1, end - overlap);
    const space = full.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = Math.max(next, start + 1);
  }
  return chunks;
}
