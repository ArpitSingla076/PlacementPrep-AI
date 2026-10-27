import { z } from 'zod';
import { env } from '../config/env.js';

export const askSchema = z
  .object({
    question: z.string().trim().min(3, 'Ask a question of at least 3 characters.').max(env.MAX_QUESTION_CHARS, `Keep the question under ${env.MAX_QUESTION_CHARS} characters.`),
    conversationId: z.string().min(1).optional(),
    // Optional: restrict the search to specific documents. The server still verifies the user owns each one.
    documentIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();
