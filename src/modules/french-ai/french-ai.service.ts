/**
 * french-ai.service.ts
 *
 * Free stack:
 *  - Speech-to-text : Groq Whisper API        (free tier — 7 200 req/day)
 *  - AI brain       : Groq LLaMA 3.3-70b      (free tier — 14 400 req/day)
 *  - Text-to-speech : Kokoro via HF Inference  (free)
 *
 * All Groq calls go through groq.client.ts for key rotation + failure tracking.
 */

import FormData from 'form-data';
import fetch from 'node-fetch';
import { AppError } from '../../shared/errors';
import { groq } from '../../shared/groq.client';
import type { ChatRequest, TTSRequest, TutorConfig, RoleplayScene } from './french-ai.schema';
import { TUTOR_CONFIG } from './french-ai.data';

// ── Env ───────────────────────────────────────────────────────────────────────
const HF_API_TOKEN = process.env.HF_API_TOKEN ?? '';

const KOKORO_MODEL  = 'hexgrad/Kokoro-82M';
const KOKORO_HF_URL = `https://api-inference.huggingface.co/models/${KOKORO_MODEL}`;

// ── System prompts ────────────────────────────────────────────────────────────
function buildSystemPrompt(
  mode: ChatRequest['mode'],
  level: ChatRequest['userLevel'],
  scene?: string,
): string {
  const levelGuide: Record<ChatRequest['userLevel'], string> = {
    A1: 'Use very simple sentences (present tense, common vocabulary, max 10 words per sentence). Speak slowly and clearly.',
    A2: 'Use simple sentences with some past tense. Keep everyday vocabulary. Introduce one new word per reply.',
    B1: 'Use varied tenses and natural sentences. Introduce idioms occasionally. Encourage the student to elaborate.',
    B2: 'Use natural, complex French as a native speaker would. Challenge the student with nuanced vocabulary.',
    C1: 'Use fluent, flexible, and detailed French. Include idiomatic expressions, subtle nuances, and varied sentence structures. Encourage debate, opinions, and precise expression.',
    C2: 'Use fully natural, sophisticated, and expressive French. Incorporate cultural references, implicit meaning, humor, and advanced idioms. Interact as with an educated native speaker.',
  };

  const base = `You are an enthusiastic, encouraging French tutor. The student is at CEFR level ${level}.
${levelGuide[level]}

RESPONSE FORMAT — always follow this EXACTLY (each section on its own line):

FRENCH: [Your French reply here]
ENGLISH: [English translation of your French reply]
CORRECTION: [If the student made a grammar/spelling mistake: "❌ [wrong] → ✅ [correct] — [brief English explanation]". If no mistake, write "none"]
TIP: [A short, practical pronunciation or grammar tip relevant to what was just said — in English. Always include one.]
SUGGESTIONS: [Exactly 3 comma-separated short French phrases the student could say next, matching their level. Make them contextually relevant to this specific conversation turn.]

Rules:
- FRENCH section must always be warm, natural, and encouraging
- SUGGESTIONS must advance the conversation naturally — never repeat previous suggestions
- Keep FRENCH reply concise: 1-3 sentences max
- Never break the format above`;

  if (mode === 'correction') {
    return `${base}

Your job: correct the student's French, explain the mistake clearly, then continue the conversation.
In FRENCH: write the corrected version + a warm continuation.
In CORRECTION: always provide a correction even for small issues.`;
  }

  if (mode === 'roleplay' && scene) {
    return `${base}

You are playing a native French speaker in this scene: "${scene}".
Stay in character at all times. In FRENCH: respond as your character would, naturally guiding the scene forward.
In SUGGESTIONS: give phrases specific to this scene that a learner would realistically say next.`;
  }

  if (mode === 'pronunciation') {
    return `${base}

Focus on spoken French. In TIP: give a detailed phonetics/pronunciation tip about sounds in your reply.`;
  }

  return `${base}

Have a natural, encouraging conversation. Always end your FRENCH reply with a follow-up question to keep the student speaking.`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export async function chatWithTutor(payload: ChatRequest): Promise<{
  reply: string;
  translation: string;
  correction: string | null;
  tip: string | null;
  suggestions: string[];
  rawContent: string;
}> {
  const systemPrompt = buildSystemPrompt(
    payload.mode,
    payload.userLevel,
    payload.roleplayScene,
  );

  const data = await groq.chat({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...payload.messages,
    ],
    temperature: 0.75,
    max_tokens: 600,
  });

  const rawContent = groq.extractText(data);

  const extract = (key: string): string => {
    const match = rawContent.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's'));
    return match?.[1]?.trim() ?? '';
  };

  const reply         = extract('FRENCH');
  const translation   = extract('ENGLISH');
  const rawCorrection = extract('CORRECTION');
  const tip           = extract('TIP') || null;
  const correction    = rawCorrection && rawCorrection.toLowerCase() !== 'none'
    ? rawCorrection
    : null;

  const rawSuggestions = extract('SUGGESTIONS');
  const suggestions = rawSuggestions
    ? rawSuggestions.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
    : [];

  return { reply, translation, correction, tip, suggestions, rawContent };
}

// ── Transcription ─────────────────────────────────────────────────────────────
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  language = 'fr',
): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append('file', audioBuffer, {
    filename:    'audio.m4a',
    contentType: mimeType,
  });
  form.append('model', 'whisper-large-v3');
  form.append('language', language);
  form.append('response_format', 'json');

  const data = await groq.transcribe(form);
  return { text: data.text ?? '', language: data.language ?? language };
}

// ── Text-to-Speech ────────────────────────────────────────────────────────────
export async function synthesizeSpeech(payload: TTSRequest): Promise<Buffer> {
  const kokoro = await tryKokoro(payload.text);
  if (kokoro.length) return kokoro;
  return tryGoogleTTS(payload.text);
}

async function tryKokoro(text: string): Promise<Buffer> {
  if (!HF_API_TOKEN) return Buffer.alloc(0);

  try {
    const res = await fetch(KOKORO_HF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HF_API_TOKEN}`,
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!res.ok) {
      console.warn('Kokoro unavailable, using fallback TTS');
      return Buffer.alloc(0);
    }

    return Buffer.from(await res.arrayBuffer());
  } catch {
    return Buffer.alloc(0);
  }
}

async function tryGoogleTTS(text: string): Promise<Buffer> {
  const encoded = encodeURIComponent(text.slice(0, 200));
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=fr&client=gtx`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!res.ok) throw new AppError('TTS unavailable', 502);
  return Buffer.from(await res.arrayBuffer());
}

// ── Config ────────────────────────────────────────────────────────────────────
export function getTutorConfig(): TutorConfig {
  return TUTOR_CONFIG;
}

export type { TutorConfig, RoleplayScene };

// ── Pronunciation Scoring ─────────────────────────────────────────────────────
export async function scorePronunciation(
  audioBuffer: Buffer,
  mimeType: string,
  expectedText: string,
): Promise<{
  score:      number;
  transcript: string;
  wordScores: { word: string; correct: boolean }[];
  feedback:   string;
}> {
  const { text: transcript } = await transcribeAudio(audioBuffer, mimeType, 'fr');

  const normalise = (s: string) =>
    s.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüÿœæç\s]/g, '').trim();

  const expectedWords = normalise(expectedText).split(/\s+/);
  const spokenWords   = normalise(transcript).split(/\s+/);

  let correct = 0;
  const wordScores = expectedWords.map((word, i) => {
    const match = spokenWords[i] === word;
    if (match) correct++;
    return { word, correct: match };
  });

  const score = Math.round((correct / Math.max(expectedWords.length, 1)) * 100);

  let feedback: string;
  if (score === 100)    feedback = 'Parfait! Your pronunciation is excellent. 🎉';
  else if (score >= 80) feedback = 'Très bien! A few minor differences — keep it up!';
  else if (score >= 60) feedback = 'Pas mal! Focus on the highlighted words and try again.';
  else                  feedback = 'Keep practising! Listen to the model audio first, then record.';

  return { score, transcript, wordScores, feedback };
}