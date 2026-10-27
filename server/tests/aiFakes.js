// Prompt-driven stand-ins for interview generation/evaluation and plan writing, used by the fake Gemini app server.
// TEST CODE ONLY: deterministic logic, not a language model.
export function fakeInterviewQuestions(prompt) {
  const n = Number(/Number of questions: (\d+)/.exec(prompt)[1]);
  return { questions: Array.from({ length: n }, (_, i) => ({
    question: `Question ${i + 1}: explain the concept of ${i % 2 ? 'normalization' : 'SQL joins'} in detail.`,
    topic: i % 2 ? 'Normalization' : 'SQL joins', difficulty: 'medium', keyPoints: ['atomic values per column', 'primary key dependency', 'partial dependencies removed'],
  })) };
}

export function fakeInterviewEvaluation(prompt) {
  const answer = (/<answer>\n([\s\S]*?)\n<\/answer>/.exec(prompt)?.[1] ?? '').toLowerCase();
  const points = [...prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1].toLowerCase());
  return {
    coveredPoints: points.map((p) => answer.includes(p.split(' ')[0])), correctness: 5, relevance: 4, clarity: 3,
    whatWasCorrect: ['Mentioned relevant ideas.'], missingOrIncorrect: ['Could be more complete.'],
    strongerAnswer: 'A strong answer states atomic values, primary key dependency and removal of partial dependencies.', followUp: 'How does this relate to denormalization?',
  };
}

export function fakePlan(prompt) {
  const keys = [...prompt.matchAll(/^- key: (.+)$/gm)].map((m) => m[1]);
  return { items: keys.map((key) => ({ key, action: `Revise ${key.split(':')[1]} using your notes.`, practice: [{ type: 'question', text: `Explain ${key.split(':')[1]} in your own words.` }] })) };
}

/** Quiz writer double: one question per source passage, built from words IN that passage. The right answer is always option 0 (the server shuffles). */
export function fakeQuiz(prompt) {
  const n = Number(/Number of questions: (\d+)/.exec(prompt)[1]);
  const sources = [...prompt.matchAll(/<source n="(\d+)" document="([^"]*)">\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ n: Number(m[1]), text: m[3].replace(/\s+/g, ' ') }));
  return { questions: sources.slice(0, n).map((s) => {
    const sentence = s.text.split(/(?<=[.!?])\s+/)[0].slice(0, 150);
    return { sourceN: s.n, question: `According to your notes, which statement is correct (passage ${s.n})?`, options: [sentence, 'It is never used in practice', 'It was removed from the standard', 'It applies only to hardware'], correctIndex: 0,
      explanation: `The passage states: ${sentence}`, topic: 'Notes review' };
  }) };
}
