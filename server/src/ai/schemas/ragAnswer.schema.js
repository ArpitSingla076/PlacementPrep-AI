import { z } from 'zod';

/**
 * What the model returns for a RAG question. Citations are numbers of the sources we gave it ([1], [2], ...).
 * The server checks every number against the sources it actually sent, so a citation can never point at something
 * that was not retrieved.
 */
export const ragAnswerSchema = z.object({
  sufficient: z.boolean().describe('true only if the sources contain enough information to answer the question.'),
  sections: z.array(z.object({
    text: z.string().trim().min(1).max(900).describe('One to three sentences of the answer, using only information from the cited sources.'),
    sources: z.array(z.number().int().min(1).max(50)).min(1).max(4).describe('Numbers of the sources that support this text.'),
  }).strict()).max(5),
  limitations: z.string().trim().max(300).describe('What the sources do not cover, or an empty string.'),
}).strict();
