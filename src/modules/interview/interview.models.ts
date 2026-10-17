// ─────────────────────────────────────────────────────────────
// Model tiering constants — local to the interview module.
//
// groq.client.ts (your real file) does NOT export named model constants.
// It accepts an optional `model` field on GroqChatParams and falls back to
// a private DEFAULT_MODEL ('openai/gpt-oss-120b') if omitted. That
// param-passthrough already works correctly — no changes needed in
// groq.client.ts itself for tiering to work.
//
// What WAS wrong in the previous draft: it referenced groq.MODEL_SMALL /
// groq.MODEL_LARGE as if the client exported them. It doesn't. Defining
// them here, locally, and passing the string directly into `model: ...`
// on each chat() call is the correct fix — zero changes to groq.client.ts.
//
// groq.client.ts is a process-wide singleton (module-level key pool), so if
// other apps in this codebase (e.g. a French-learning app) also import
// `{ groq }` from the same module, they share key rotation state with this
// app. That's fine and intentional — key rotation and `model` selection are
// fully independent concerns in this client (model is just a JSON field in
// the request body; it has no bearing on which API key gets used). Tiering
// models here does not affect, and is not affected by, what model other
// callers choose.
// ─────────────────────────────────────────────────────────────

/** Cheap/fast model — mechanical extraction into a fixed schema (classification, translation). */
export const MODEL_SMALL = process.env.GROQ_MODEL_SMALL || 'llama-3.1-8b-instant';

/** Same as groq.client.ts's private DEFAULT_MODEL. Kept explicit here so call
 * sites that care about generation quality are self-documenting, rather than
 * relying on omitting `model` and hoping the client's default matches intent. */
export const MODEL_LARGE = process.env.GROQ_MODEL_LARGE || 'openai/gpt-oss-120b';