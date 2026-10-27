// Shared by the mock LLM (fixtures.js) and the fake Gemini app server: a "faithful" RAG answerer that reads the sources
// out of the prompt it is given. TEST CODE ONLY: it models an honest model, it says nothing about real model behaviour.
export const contentWords = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

export const parseSources = (prompt) =>
  [...prompt.matchAll(/<source n="(\d+)" document="([^"]*)" pages="([^"]*)">\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ n: Number(m[1]), document: m[2], text: m[4] }));

const bestSentence = (text, qWords) =>
  text.split(/(?<=[.!?])\s+/).map((s) => ({ s, o: [...contentWords(s)].filter((w) => qWords.has(w)).length })).sort((a, b) => b.o - a.o)[0].s;

export function faithfulRagAnswer(prompt) {
  const q = contentWords(/<question>\n([\s\S]*?)\n<\/question>/.exec(prompt)?.[1] ?? '');
  const ranked = parseSources(prompt).map((s) => ({ ...s, overlap: [...contentWords(s.text)].filter((w) => q.has(w)).length })).sort((a, b) => b.overlap - a.overlap);
  return ranked.length && ranked[0].overlap > 0
    ? { sufficient: true, sections: [{ text: bestSentence(ranked[0].text, q), sources: [ranked[0].n] }], limitations: '' }
    : { sufficient: false, sections: [], limitations: 'The sources do not cover this question.' };
}
