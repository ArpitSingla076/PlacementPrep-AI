import { z } from 'zod';

const text = (n) => z.string().trim().max(n);

/** Built per request: `sourceCount` is how many passages the model was given, so it can only cite those. */
export function quizSchema(sourceCount) {
  return z.object({
    questions: z.array(z.object({
      sourceN: z.number().int().describe('Number of the source passage this question is based on.'),
      question: text(300).min(10),
      options: z.array(text(160).min(1)).describe('Exactly 4 answer options.'),
      correctIndex: z.number().int().describe('Index (0 to 3) of the one correct option.'),
      explanation: text(300).min(5).describe('Why the correct option is right, using the source.'),
      topic: text(60).min(2).describe('A short topic label.'),
    }).strict()).min(1).max(10),
  }).strict().superRefine((v, ctx) => {
    v.questions.forEach((q, i) => {
      const bad = (message) => ctx.addIssue({ code: 'custom', path: ['questions', i], message });
      if (q.sourceN < 1 || q.sourceN > sourceCount) bad(`sourceN must be between 1 and ${sourceCount}`);
      if (q.options.length !== 4) bad('options must contain exactly 4 items');
      if (new Set(q.options.map((o) => o.toLowerCase().trim())).size !== q.options.length) bad('options must all be different');
      if (q.correctIndex < 0 || q.correctIndex > 3) bad('correctIndex must be 0, 1, 2 or 3');
    });
  });
}
