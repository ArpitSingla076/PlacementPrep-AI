# Security and privacy notes

## Authentication and sessions
bcrypt password hashing; JWT in an httpOnly cookie; CSRF value carried in the JWT and echoed in `X-CSRF-Token` (kept in memory by the SPA); strict CORS and an `Origin` check on state-changing requests; `tokenVersion` for "sign out everywhere"; constant-message login failures; per-IP limits on login/register and on the whole API.

## Authorisation
Every query is filtered by the authenticated user's id; another user's resource id returns 404 (no existence leak). Tests cover cross-user access for resumes, analyses, documents, chat, interviews, plans and progress. Vector search is pre-filtered by user and document.

## Files
PDFs are held in memory only (never written to disk; no path traversal). Type is checked by content (magic bytes), not extension or MIME type. Size, page and text limits apply; filenames are sanitised. Only extracted text is stored, never the original file.

## AI
| Risk | Control |
|---|---|
| Sending data without consent | `requireAiConsent` on every route that sends content to the provider, read from the stored user record |
| Over-sharing | Resume emails and phone numbers removed before sending; resume analysis personalisation sends skill names only; plans send topic names and computed scores only |
| Prompt injection (resume, job description, notes, answers) | Untrusted text is wrapped in tags with closing tags neutralised; system instructions are separate; output schemas are strict; scoring and plan structure are computed by code; citations are validated against what was actually sent. This reduces risk, it does not eliminate it: a hostile document can still influence the wording of an answer about that document |
| Hallucinated evidence or citations | Quotes verified in code; unverified claims scored as no evidence; citations to sources that were not provided are removed |
| Cost abuse | Per-user hourly quotas (refunded on failure), caching, de-duplication, token cap, bounded retries, size limits |
| Secrets | API key and DB credentials only in server environment; never in client code, logs or responses; logs contain no prompts, documents or answers |

## What is sent to Google (Gemini API)
| Feature | Sent |
|---|---|
| Resume analysis | Resume text (contact details removed) + pasted job description |
| Documents | Text of your notes, in passages, for embedding |
| Assistant | Your question; the most relevant passages from your notes |
| Mock interview | Role, level, category, optional job description and skill names; your written answers |
| Preparation plan | Topic names, priorities and computed facts |
| Quizzes | Random passages from your notes |

Retention and training use depend on the plan behind the API key. **Read the current Gemini API terms before using real personal data**; this was not verified here.

## Data deletion
Deleting a resume also deletes the analyses made from it. Deleting a document deletes its chunks and vectors and clears the passage text kept in chat citations and quiz sources (the assistant's generated answer text is kept). Deleting an interview removes it from progress. **Delete account** (Settings, password required) removes the user and every record in every collection they own. A registry of user-owned models drives this, and a test fails if a model with a `userId` field is ever added without being registered, so a new feature cannot leave personal data behind. **Download my data** exports everything stored about the user (vectors excluded). Changing the password signs out all other devices.

## Known gaps
No email verification, password reset or MFA. Account deletion removes data from this app's database; it cannot recall content already sent to the AI provider (see its retention terms). One long-lived session token (7 days) with server-side revocation via "sign out everywhere". In-memory quotas and limiters are per instance. No malware scanning of uploads (they are parsed, never executed or stored). No dependency-update automation.
