# Gemini integration notes: what was verified, how, and what was not

Written during Milestone 2 (October 2026). Model names and APIs change quickly, so treat everything marked
**unverified** as something to confirm with `npm run ai:check` (it uses your own API key against the real API).

## How verification was done

The build environment could **not** reach `ai.google.dev` or the Gemini API (network blocked), so the official docs
pages were not read and no live call was made. Instead:

| Source | What it was used for |
|---|---|
| `@google/genai@2.29.0` package: README and `dist/genai.d.ts` (its type definitions) | Method names, config options, error class, retry behaviour |
| Google's `googleapis/js-genai` and `google-gemini/cookbook` repos (GitHub) | Embedding model names, dimensions, usage examples |
| Google's `google-gemini/gemini-cli` source (`packages/core/src/config/models.ts`) | Current model IDs and which are labelled stable/GA vs preview |
| A local server speaking Gemini's REST wire format, driven by the **real SDK** | Our request shape, error mapping, retry and timeout behaviour |

## Verified (from SDK source/types, or by running the real SDK locally)

- **SDK and method:** `@google/genai` (v2.x), `new GoogleGenAI({ apiKey, httpOptions })`, `ai.models.generateContent({ model, contents, config })`. This is still the quickstart method in the SDK README. The newer *Interactions* API stores conversation state on Google's side; we deliberately do not use it, because our own database owns all state.
- **Structured output:** `config.responseMimeType: 'application/json'` plus `config.responseJsonSchema`. The SDK types document the **only** JSON Schema keywords supported: `$id, $defs, $ref, $anchor, type, format, title, description, enum, items, prefixItems, minItems, maxItems, minimum, maximum, anyOf, oneOf, properties, additionalProperties, required, propertyOrdering`. `maxLength`, `minLength`, `pattern`, `default`, `$schema` are not supported, so `src/ai/jsonSchema.js` prunes the Zod-generated schema to that list. Zod remains the validator of record.
- **Config fields used:** `systemInstruction, temperature, maxOutputTokens, thinkingConfig (thinkingBudget | thinkingLevel), abortSignal, httpOptions.timeout`.
- **Errors:** the SDK throws `ApiError` with a numeric `status`. Mapped in `providers/gemini.js`.
- **Retries:** with no `retryOptions` the SDK 2.29.0 sent **one** request (measured). We still pass `attempts: 1` explicitly and run our own bounded retry policy (`ai/retry.js`). *(An earlier draft of these notes assumed the SDK retries 5 times by default; the experiment showed that is wrong.)*
- **Model listing:** `Model.supportedActions` exists in the types, used by `ai:check` to show which models support `generateContent` / `embedContent`.
- **Embedding API shape:** `ai.models.embedContent({ model, contents, config: { outputDimensionality, taskType, title } })`. `outputDimensionality` truncates "from the end". Against a local server the SDK called `POST /v1beta/models/<model>:batchEmbedContents`.

## Model IDs (strong but secondary evidence; confirm with `ai:check`)

From Google's `gemini-cli` source retrieved 2026-10-14:

| ID | Label in that source |
|---|---|
| `gemini-3.1-flash-lite` | "Base (stable GA)" Flash-Lite tier. A deprecation note says "Gemini 3.1 Flash Lite is now GA". |
| `gemini-3.5-flash` | "Base (stable GA)" Flash tier |
| `gemini-3.5-flash-lite`, `gemini-3.8-flash` | "Latest (experiment-gated GA)": avoid for now |
| `gemini-3-pro-preview`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview` | Preview |
| `gemini-embedding-001` | Default embedding model in that repo |

`-latest` aliases (e.g. `gemini-flash-latest`, used in the SDK README) can change underneath you, so this project stores the
**exact model** with every analysis and does not default to an alias.

Cost guidance (not measured): the Flash-Lite tier is the cheapest tier, so it is the suggested starting point. If
`npm run ai:check:full` reports frequent "unverified claims", try the Flash tier.
**Pricing and free-tier limits were not verified**: check the pricing page for your account.

## Embeddings (for Milestone 3)

From the Gemini cookbook (embeddings quickstart) and SDK types:

- Models: `gemini-embedding-2` ("first multimodal embedding model in the Gemini API"; text up to **8,192 tokens**) and `gemini-embedding-001` ("remains available for text-only use cases").
- Default output is **3072 dimensions**. `outputDimensionality` reduces it (the cookbook demonstrates 10).
- **Batching gotcha:** the cookbook shows that, for `gemini-embedding-2`, a list containing mixed inputs yields **one** aggregated embedding, and separate `Content` objects yield one embedding each. When embedding N text chunks we must confirm we get N vectors back. `ai:check` tests this.
- **Unverified (confirm before building the index):**
  - supported `outputDimensionality` range and recommended sizes (recollection: 128 to 3072, with 768 / 1536 / 3072 recommended),
  - whether truncated vectors are unit-length (recollection: only the full-size vector is pre-normalised). `ai:check` prints the L2 norm; if it is not ~1.0, normalise before cosine / dot-product search,
  - **MongoDB Atlas Vector Search limits** (maximum dimensions, number of search indexes on the free M0 tier, `filter` field declaration, similarity options). Not verifiable from this environment. Check Atlas documentation at the start of Milestone 3 and choose `numDimensions` to match the measured dimension from `ai:check`.

## What data is sent to Google

| Feature | Sent | Not sent |
|---|---|---|
| Resume analysis | Resume **text** (emails and phone numbers replaced by `[EMAIL]`/`[PHONE]`), the job description you paste, and the prompt | The PDF file, your account email/password, other users' data |

Sending requires the user's explicit "Allow AI processing" consent (enforced on the server, not just in the UI).
Names, schools, employers and links in a resume are **not** removed. How Google retains or uses submitted content depends on the
plan behind the API key (free and paid terms can differ). **Read the current Gemini API terms before using real resumes** and
consider a paid plan for anything sensitive; this was not verified here.
