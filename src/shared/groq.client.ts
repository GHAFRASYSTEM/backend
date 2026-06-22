/**
 * groq.client.ts
 *
 * Central Groq API client with round-robin key rotation.
 *
 * Behaviour:
 *  - Keys rotate on every 429 (rate limit) or 5xx response
 *  - A failed key is marked with a cooldown timestamp
 *  - After COOLDOWN_MS the key re-enters rotation automatically
 *  - Every request logs which key index is active and any handoff
 *  - If ALL keys are exhausted, throws with a clear summary
 *
 * Usage:
 *   import { groq } from './groq.client';
 *   const data = await groq.chat({ model, messages, temperature, max_tokens });
 *   const data = await groq.transcribe(formData);
 */

import { env } from '../config/env';
import { Errors } from './errors';


// ─────────────────────────────────────────────────────────────
// Key pool — add keys to env as GROQ_API_KEY_1, _2, _3 …
// Falls back to the single GROQ_API_KEY for backwards compat.
// ─────────────────────────────────────────────────────────────

function loadKeys(): string[] {
  const keys: string[] = [];

  // Multi-key setup: GROQ_API_KEY_1, GROQ_API_KEY_2, …
  let i = 1;
  while (true) {
    const k = (env as any)[`GROQ_API_KEY_${i}`] ?? process.env[`GROQ_API_KEY_${i}`];
    if (!k) break;
    keys.push(k);
    i++;
  }

  // Single-key fallback
  const single = env.GROQ_API_KEY ?? process.env.GROQ_API_KEY;
  if (single && !keys.includes(single)) keys.push(single);

  if (keys.length === 0) throw new Error('No GROQ_API_KEY configured');
  return keys;
}

// ─────────────────────────────────────────────────────────────
// Key state tracker
// ─────────────────────────────────────────────────────────────

const COOLDOWN_MS = 60_000; // 1 min before a failed key re-enters rotation

type KeyState = {
  key: string;
  index: number;        // 1-based display index
  failedAt: number | null;
  totalFailures: number;
  totalRequests: number;
};

class GroqKeyPool {
  private states: KeyState[];
  private cursor: number = 0; // points to the currently active key

  constructor(keys: string[]) {
    this.states = keys.map((key, i) => ({
      key,
      index: i + 1,
      failedAt: null,
      totalFailures: 0,
      totalRequests: 0,
    }));
  }

  /** Returns the current active key state, skipping cooled-down keys if possible */
  current(): KeyState {
    return this.states[this.cursor];
  }

  /**
   * Mark the current key as failed and advance to the next available key.
   * Returns the new active key, or null if all keys are exhausted.
   */
  rotate(reason: string): KeyState | null {
    const failed = this.states[this.cursor];
    failed.failedAt = Date.now();
    failed.totalFailures++;

    console.warn(
      `🔑 Key #${failed.index} failed (${reason}) — rotating. ` +
      `Total failures on this key: ${failed.totalFailures}`,
    );

    // Try each remaining key in order
    for (let attempt = 1; attempt < this.states.length; attempt++) {
      const next = (this.cursor + attempt) % this.states.length;
      const candidate = this.states[next];

      // Skip if still in cooldown
      if (candidate.failedAt !== null) {
        const elapsed = Date.now() - candidate.failedAt;
        if (elapsed < COOLDOWN_MS) {
          console.warn(
            `🔑 Key #${candidate.index} still cooling down ` +
            `(${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s left)`,
          );
          continue;
        }
        // Cooldown expired — bring it back
        console.log(`🔑 Key #${candidate.index} cooldown expired — re-entering rotation`);
        candidate.failedAt = null;
      }

      this.cursor = next;
      console.log(`🔑 Switched to key #${candidate.index}`);
      return candidate;
    }

    // All keys exhausted — summarise state
    const summary = this.states.map(s => {
      if (!s.failedAt) return `Key #${s.index}: OK`;
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - s.failedAt)) / 1000);
      return `Key #${s.index}: cooling down (${remaining}s)`;
    }).join(', ');

    console.error(`❌ All Groq keys exhausted. State: ${summary}`);
    return null;
  }

  /** Called on success — increments request counter and logs active key */
  recordSuccess(): void {
    const s = this.states[this.cursor];
    s.totalRequests++;
  }

  /** Human-readable pool status for debugging */
  status(): string {
    return this.states.map(s => {
      const active = this.cursor === this.states.indexOf(s) ? ' ← active' : '';
      if (s.failedAt) {
        const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - s.failedAt)) / 1000);
        return `Key #${s.index}: cooling (${remaining}s)${active}`;
      }
      return `Key #${s.index}: OK [${s.totalRequests} reqs, ${s.totalFailures} fails]${active}`;
    }).join(' | ');
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton pool — initialised once at module load
// ─────────────────────────────────────────────────────────────

let pool: GroqKeyPool;
try {
  pool = new GroqKeyPool(loadKeys());
} catch (e: any) {
  // Defer the error to the first actual call so server still boots
  console.error('⚠️  Groq key pool failed to initialise:', e.message);
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatParams {
  model?: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface GroqTranscriptionResponse {
  text?: string;
  language?: string;
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// ─────────────────────────────────────────────────────────────
// Core fetch wrapper — retries across all available keys
// ─────────────────────────────────────────────────────────────

async function groqFetch(
  path: string,
  buildRequest: (key: string) => RequestInit,
): Promise<Response> {
  if (!pool) throw Errors.internal('Groq key pool not initialised');

  let attempts = 0;
  const maxAttempts = pool['states'].length + 1; // one pass through all keys

  while (attempts < maxAttempts) {
    attempts++;
    const state = pool.current();

    console.log(`🔑 Groq request via key #${state.index} (attempt ${attempts})`);

    const res = await fetch(`https://api.groq.com${path}`, buildRequest(state.key));

    if (res.ok) {
      pool.recordSuccess();
      return res;
    }

    const status = res.status;
    const body = await res.text();

    // Rate limit or server error — rotate and retry
    if (status === 429 || status >= 500) {
      console.error(`❌ Groq key #${state.index} returned ${status}: ${body}`);
      const next = pool.rotate(`HTTP ${status}`);
      if (!next) {
        throw Errors.internal(
          `All Groq API keys exhausted. Status: ${pool.status()}`,
        );
      }
      continue; // retry with new key
    }

    // 4xx that isn't rate limit (bad request, auth error, etc.) — don't rotate
    console.error(`❌ Groq non-retryable error [${status}]:`, body);
    throw Errors.internal(`Groq error ${status}: ${body}`);
  }

  throw Errors.internal('Groq request failed after exhausting all keys');
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

async function chat(params: GroqChatParams): Promise<GroqChatResponse> {
  const res = await groqFetch(
    '/openai/v1/chat/completions',
    (key) => ({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:       params.model ?? DEFAULT_MODEL,
        messages:    params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens:  params.max_tokens ?? 600,
      }),
    }),
  );
  return res.json() as Promise<GroqChatResponse>;
}

// Accepts both browser FormData and node `form-data` package.
// node form-data exposes getHeaders() which must be spread into fetch headers.
async function transcribe(formData: FormData | any): Promise<GroqTranscriptionResponse> {
  const res = await groqFetch(
    '/openai/v1/audio/transcriptions',
    (key) => {
      const extraHeaders = typeof (formData as any).getHeaders === 'function'
        ? (formData as any).getHeaders()
        : {};
      return {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, ...extraHeaders },
        body: formData,
      };
    },
  );
  return res.json() as Promise<GroqTranscriptionResponse>;
}

/** Convenience: extract text from the first choice */
function extractText(response: GroqChatResponse): string {
  return response.choices?.[0]?.message?.content?.trim() ?? '';
}

/** Log current pool status — useful to expose on a /health endpoint */
function poolStatus(): string {
  return pool?.status() ?? 'pool not initialised';
}

export const groq = { chat, transcribe, extractText, poolStatus };