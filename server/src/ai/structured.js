import { AiError, aiNotConfigured } from './errors.js';
import { withRetry } from './retry.js';
import { toProviderJsonSchema } from './jsonSchema.js';

function parseJson(text) {
  // JSON mode should return bare JSON, but tolerate a markdown code fence just in case.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function summarizeIssues(error) {
  return error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

/**
 * Ask the model for JSON, then VALIDATE it with Zod. If the output is malformed, make ONE repair attempt
 * (show the model its own output + the validation errors). If it is still invalid, fail - we never persist or
 * display unvalidated model output, and we never substitute fake data.
 *
 * Returns { data, usage, repaired, model }.
 */
export async function generateStructured({
  provider, systemInstruction, userPrompt, schema, temperature = 0.2,
  retries = 2, retryBaseMs = 1500, maxRepairAttempts = 1, sleep, onRetry,
}) {
  if (!provider.isConfigured) throw aiNotConfigured();

  const jsonSchema = toProviderJsonSchema(schema);
  const messages = [{ role: 'user', text: userPrompt }];
  const usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    const result = await withRetry(
      () => provider.generate({ systemInstruction, messages, jsonSchema, temperature: attempt === 0 ? temperature : 0 }),
      { retries, baseMs: retryBaseMs, sleep, onRetry },
    );
    usage.promptTokens += result.usage.promptTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.totalTokens += result.usage.totalTokens;

    if (result.finishReason === 'MAX_TOKENS') {
      // Cut off mid-JSON. Re-asking the same prompt would be cut off again, so don't burn quota on it.
      throw new AiError(502, 'AI_TRUNCATED', 'The AI response was cut off because it was too long. Try a shorter job description.');
    }

    let issues;
    try {
      const parsed = schema.safeParse(parseJson(result.text));
      if (parsed.success) return { data: parsed.data, usage, repaired: attempt > 0, model: provider.model };
      issues = summarizeIssues(parsed.error);
    } catch {
      issues = ['The response was not valid JSON.'];
    }

    if (attempt < maxRepairAttempts) {
      messages.push(
        { role: 'model', text: result.text },
        { role: 'user', text: `Your previous JSON failed validation:\n- ${issues.join('\n- ')}\nReturn the corrected JSON only, following the schema exactly.` },
      );
    }
  }

  throw new AiError(502, 'AI_INVALID_RESPONSE', 'The AI returned a response we could not validate, so no result was saved. Please try again.');
}
