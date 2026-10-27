import { describe, it, expect } from 'vitest';
import { chunkPages } from '../src/ai/rag/chunker.js';

const sentence = (i) => `Sentence number ${i} explains one idea about databases and indexing in some detail.`;
const para = (n, from = 0) => Array.from({ length: n }, (_, i) => sentence(from + i)).join(' ');

describe('chunkPages', () => {
  it('splits long text into chunks no longer than the size, with overlap between neighbours', () => {
    const chunks = chunkPages([para(60)], { size: 500, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(500);
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].text.slice(-60);
      const probe = tail.split(' ').slice(-4).join(' ');
      expect(chunks[i].text).toContain(probe.trim()); // the end of the previous chunk reappears at the start of the next
    }
  });

  it('never loses content: every sentence appears in at least one chunk', () => {
    const chunks = chunkPages([para(40)], { size: 400, overlap: 80 });
    const all = chunks.map((c) => c.text).join('\n');
    for (let i = 0; i < 40; i++) expect(all).toContain(`Sentence number ${i} `);
  });

  it('prefers to cut at sentence or paragraph boundaries, not mid-word', () => {
    const chunks = chunkPages([para(30)], { size: 300, overlap: 60 });
    for (const c of chunks.slice(0, -1)) expect(c.text).toMatch(/[.!?]$/);
    for (const c of chunks) expect(c.text).toMatch(/^[A-Za-z]/); // starts on a word, not a fragment
    for (const c of chunks) expect(c.text.startsWith('entence')).toBe(false);
  });

  it('tracks page numbers exactly, including chunks that span a page break', () => {
    // Each page uses its own marker word, so we can tell from the TEXT which pages a chunk touches.
    const page = (word) => Array.from({ length: 8 }, (_, i) => `The ${word} section describes topic number ${i} at some length.`).join(' ');
    const chunks = chunkPages([page('alphaword'), page('betaword'), page('gammaword')], { size: 300, overlap: 50 });

    const pagesInText = (c) => [['alphaword', 1], ['betaword', 2], ['gammaword', 3]].filter(([w]) => c.text.includes(w)).map(([, p]) => p);
    let spanning = 0;
    for (const c of chunks) {
      const truth = pagesInText(c);
      expect(c.pageStart).toBe(Math.min(...truth)); // reported pages must match the pages the text really comes from
      expect(c.pageEnd).toBe(Math.max(...truth));
      if (c.pageEnd > c.pageStart) spanning++;
    }
    expect(spanning).toBeGreaterThan(0); // the scenario really did produce page-spanning chunks
    expect(chunks.some((c) => c.pageStart === 2 && c.pageEnd === 2)).toBe(true);
  });

  it('returns one chunk for short text and nothing for empty or noise-only text', () => {
    expect(chunkPages(['A short note about joins in SQL databases that fits in one chunk.'], { size: 500, overlap: 50 })).toHaveLength(1);
    expect(chunkPages([''], { size: 500, overlap: 50 })).toEqual([]);
    expect(chunkPages(['--- 12 ---\n\n.....'], { size: 500, overlap: 50 })).toEqual([]);
  });

  it('is deterministic and terminates for awkward input (no spaces at all)', () => {
    const blob = 'x'.repeat(5000);
    const a = chunkPages([blob], { size: 400, overlap: 80 });
    expect(a).toEqual(chunkPages([blob], { size: 400, overlap: 80 }));
    expect(a.length).toBeGreaterThan(10);
    expect(a.every((c) => c.text.length <= 400)).toBe(true);
  });

  it('rejects an overlap that would make chunking not progress', () => {
    expect(() => chunkPages(['text'], { size: 400, overlap: 300 })).toThrow(/overlap/);
  });
});
