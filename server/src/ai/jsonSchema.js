import { z } from 'zod';

/**
 * Gemini's `responseJsonSchema` accepts only a SUBSET of JSON Schema (list taken from the
 * @google/genai type definitions). Keywords such as maxLength, pattern, default or $schema are not on it.
 * minItems/maxItems ARE supported keywords, but on a large schema with many lists and enums they can make Gemini reject the
 * request with "constraint has too many states for serving" (HTTP 400). So we deliberately do NOT send list-size limits: the prompts
 * state them in words, and Zod enforces them on the response (a repair attempt follows any violation).
 * So we write ONE Zod schema, use it to VALIDATE the response, and send a pruned copy to the provider as a hint.
 * Zod stays the source of truth: the model's output is never trusted just because we sent a schema.
 */
const SUPPORTED = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum', 'items', 'prefixItems',
  'minimum', 'maximum', 'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required',
  'propertyOrdering',
]);

function prune(node) {
  if (Array.isArray(node)) return node.map(prune);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!SUPPORTED.has(key)) continue;
    if (key === 'properties' || key === '$defs') {
      // Keys here are property NAMES chosen by us, not JSON Schema keywords: keep all, prune each value.
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, prune(v)]));
    } else if (key === 'enum' || key === 'required') {
      out[key] = value; // plain arrays of strings
    } else {
      out[key] = prune(value);
    }
  }
  return out;
}

export function toProviderJsonSchema(zodSchema) {
  return prune(z.toJSONSchema(zodSchema));
}
