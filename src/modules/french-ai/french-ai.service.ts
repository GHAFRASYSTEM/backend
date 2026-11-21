/**
 * french-ai.service.ts
 *
 * Free stack:
 *  - Speech-to-text : Groq Whisper API        (free tier — 7 200 req/day)
 *  - AI brain       : Groq LLaMA 3.3-70b      (free tier — 14 400 req/day)
 *  - Text-to-speech : Kokoro via HF Inference  (free)
 *
 * All Groq calls go through groq.client.ts for key rotation + failure tracking.
 * All prompt engineering lives in french-ai.prompts.ts — this file is pure
 * plumbing: validate → build prompt → call Groq → shape the response.
 *
 * FEATURES IN THIS FILE
 *  1. Conversational tutor (chat / correction / roleplay / pronunciation modes)
 *  2. Live speech transcription + pronunciation scoring
 *  3. Text-to-speech synthesis
 *  4. AI Writing + Instant Correction
 *  5. Listening & Dictation
 *  6. Reading Comprehension
 *  7. Fill-in-the-Blank / Sentence Builder
 *  8. AI Flashcards (auto-generated from things the learner has actually seen)
 *  9. Vocab Quiz (category-driven, audio-first, multiple choice)
 */

import fetch from 'node-fetch';
import { AppError } from '../../shared/errors';
import { groq } from '../../shared/groq.client';
import type {
  ChatRequest,
  TTSRequest,
  TutorConfig,
  RoleplayScene,
  WritingCorrectionRequest,
  WritingCorrectionResult,
  DictationPassageRequest,
  DictationPassage,
  DictationCheckRequest,
  DictationCheckResult,
  ReadingExerciseRequest,
  ReadingExercise,
  ReadingAnswerCheckRequest,
  ReadingAnswerResult,
  FillBlankRequest,
  FillBlankExercise,
  FillBlankCheckRequest,
  FillBlankCheckResult,
  FlashcardSourceItem,
  Flashcard,
  VocabQuizRequest,
  VocabQuizQuestion,
  VocabQuizResult,
} from './french-ai.schema';
import { defaultTTSRequest } from './french-ai.schema';
import { TUTOR_CONFIG } from './french-ai.data';
import {
  buildChatSystemPrompt,
  buildWritingCorrectionPrompt,
  buildDictationPassagePrompt,
  buildDictationExplanationPrompt,
  buildReadingExercisePrompt,
  buildReadingGradingPrompt,
  buildFillBlankPrompt,
  buildFlashcardPrompt,
  buildVocabQuizPrompt,
  pickRandomTopic,
} from './french-ai.prompts';

// ── Env ───────────────────────────────────────────────────────────────────────
const HF_API_TOKEN = process.env.HF_API_TOKEN ?? '';

const KOKORO_MODEL  = 'hexgrad/Kokoro-82M';
const KOKORO_HF_URL = `https://api-inference.huggingface.co/models/${KOKORO_MODEL}`;

// ── Shared Groq JSON helper ───────────────────────────────────────────────────
// Sections 4-9 all want structured (array/object) output rather than the
// linear FRENCH:/ENGLISH:/... format the chat tutor uses. This wraps the
// "ask for strict JSON, strip fences, parse, throw AppError on failure" dance
// so each feature below stays short.
async function callGroqForJSON<T>(
  systemPrompt: string,
  userContent: string,
  opts?: { temperature?: number; max_tokens?: number },
): Promise<T> {
  const data = await groq.chat({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: opts?.temperature ?? 0.7,
    max_tokens: opts?.max_tokens ?? 900,
  });

  const raw = groq.extractText(data);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AppError('Failed to parse AI response as JSON', 502);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. CONVERSATIONAL TUTOR — chat / correction / roleplay / pronunciation
// ══════════════════════════════════════════════════════════════════════════
export async function chatWithTutor(payload: ChatRequest): Promise<{
  reply: string;
  translation: string;
  correction: string | null;
  tip: string | null;
  suggestions: string[];
  rawContent: string;
}> {
  const systemPrompt = buildChatSystemPrompt(
    payload.mode,
    payload.userLevel,
    payload.roleplayScene,
  );

  const data = await groq.chat({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      ...payload.messages,
    ],
    temperature: 0.85,
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

// ══════════════════════════════════════════════════════════════════════════
// 2. TRANSCRIPTION & PRONUNCIATION SCORING
// ══════════════════════════════════════════════════════════════════════════
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  language = 'fr',
): Promise<{ text: string; language: string }> {
  const buildForm = () => {
    const form = new FormData(); // native global FormData (no 'form-data' import in this file)
    const bytes = new Uint8Array(audioBuffer); // sidesteps Buffer/ArrayBufferLike typing mismatch
    const blob = new Blob([bytes], { type: mimeType });
    form.append('file', blob, 'audio.m4a');
    form.append('model', 'whisper-large-v3');
    form.append('language', language);
    form.append('response_format', 'json');
    return form;
  };

  const data = await groq.transcribe(buildForm);
  return { text: data.text ?? '', language: data.language ?? language };
}

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

// ══════════════════════════════════════════════════════════════════════════
// 3. TEXT-TO-SPEECH
// ══════════════════════════════════════════════════════════════════════════
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

    return Buffer.from(await res.arrayBuffer() as ArrayBuffer);
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

// ══════════════════════════════════════════════════════════════════════════
// 4. AI WRITING + INSTANT CORRECTION
// ══════════════════════════════════════════════════════════════════════════
export async function gradeWriting(payload: WritingCorrectionRequest): Promise<WritingCorrectionResult> {
  const systemPrompt = buildWritingCorrectionPrompt(payload.userLevel, payload.context);
  return callGroqForJSON<WritingCorrectionResult>(systemPrompt, payload.text, {
    temperature: 0.4,
    max_tokens: 1200,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 5. LISTENING & DICTATION
// ══════════════════════════════════════════════════════════════════════════
// The AI speaks a sentence/passage; the student types exactly what they hear.
// We then diff it word-by-word, highlight what's missing/wrong, and explain
// the common mistakes — replay is just re-calling synthesizeSpeech again.
export async function generateDictationPassage(
  payload: DictationPassageRequest,
): Promise<DictationPassage> {
  // No topic supplied? Pick a concrete one server-side rather than letting
  // the model invent its own — see the comment block at the top of
  // french-ai.prompts.ts for why this matters (kills the "Bonjour, je
  // m'appelle..." repetition problem).
  const topic = payload.topic ?? pickRandomTopic();
  const systemPrompt = buildDictationPassagePrompt(payload.userLevel, topic, payload.lengthWords);

  const { text } = await callGroqForJSON<{ text: string }>(
    systemPrompt,
    'Generate the passage now.',
    { temperature: 0.8, max_tokens: 300 },
  );

  const audio = await synthesizeSpeech(defaultTTSRequest(text));
  return { text, audioBase64: audio.toString('base64') };
}

// Local word-level diff, same spirit as scorePronunciation — cheap, fast,
// no AI call needed just to compare two strings.
function diffWords(original: string, attempt: string): DictationCheckResult['wordDiff'] {
  const normalise = (s: string) =>
    s.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüÿœæç'\s-]/g, '').trim();

  const origWords = normalise(original).split(/\s+/).filter(Boolean);
  const userWords = normalise(attempt).split(/\s+/).filter(Boolean);

  const diff: DictationCheckResult['wordDiff'] = [];
  const maxLen = Math.max(origWords.length, userWords.length);

  for (let i = 0; i < maxLen; i++) {
    const expected = origWords[i];
    const given = userWords[i];

    if (expected === undefined) {
      diff.push({ word: given ?? '', status: 'extra', userWord: given });
    } else if (given === undefined) {
      diff.push({ word: expected, status: 'missing' });
    } else if (expected === given) {
      diff.push({ word: expected, status: 'correct' });
    } else {
      diff.push({ word: expected, status: 'wrong', userWord: given });
    }
  }

  return diff;
}

export async function checkDictation(payload: DictationCheckRequest): Promise<DictationCheckResult> {
  const wordDiff = diffWords(payload.originalText, payload.userAttempt);
  const correctCount = wordDiff.filter(w => w.status === 'correct').length;
  const accuracyScore = Math.round((correctCount / Math.max(wordDiff.length, 1)) * 100);

  const mistakesOnly = wordDiff.filter(w => w.status !== 'correct');

  // Skip the AI call entirely for a perfect or near-empty attempt.
  if (mistakesOnly.length === 0) {
    return {
      accuracyScore,
      wordDiff,
      commonMistakeExplanations: [],
      feedback: 'Parfait! You caught every word. 🎉',
    };
  }

  const systemPrompt = buildDictationExplanationPrompt(payload.userLevel);
  const userContent = JSON.stringify({
    original: payload.originalText,
    attempt: payload.userAttempt,
    diff: mistakesOnly,
  });

  const { commonMistakeExplanations, feedback } = await callGroqForJSON<{
    commonMistakeExplanations: string[];
    feedback: string;
  }>(systemPrompt, userContent, { temperature: 0.5, max_tokens: 400 });

  return { accuracyScore, wordDiff, commonMistakeExplanations, feedback };
}

// ══════════════════════════════════════════════════════════════════════════
// 6. READING COMPREHENSION
// ══════════════════════════════════════════════════════════════════════════
// Generate a level-appropriate passage plus MCQ / short-answer / vocab-in-
// context / summary questions, then grade free-text answers afterward.
export async function generateReadingExercise(payload: ReadingExerciseRequest): Promise<ReadingExercise> {
  const topic = payload.topic ?? pickRandomTopic();
  const systemPrompt = buildReadingExercisePrompt(payload.userLevel, topic);
  return callGroqForJSON<ReadingExercise>(systemPrompt, 'Generate the exercise now.', {
    temperature: 0.75,
    max_tokens: 1200,
  });
}

export async function gradeReadingAnswers(payload: ReadingAnswerCheckRequest): Promise<ReadingAnswerResult> {
  const systemPrompt = buildReadingGradingPrompt(payload.userLevel);
  const userContent = JSON.stringify({
    passage: payload.exercise.passage,
    questions: payload.exercise.questions,
    userAnswers: payload.userAnswers,
  });

  return callGroqForJSON<ReadingAnswerResult>(systemPrompt, userContent, {
    temperature: 0.3,
    max_tokens: 900,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 7. FILL-IN-THE-BLANK / SENTENCE BUILDER
// ══════════════════════════════════════════════════════════════════════════
// Quick, dynamically-generated grammar drills: missing word, scrambled
// sentence, verb tense choice, or idiomatic expression completion.
export async function generateFillBlankSet(payload: FillBlankRequest): Promise<FillBlankExercise[]> {
  const systemPrompt = buildFillBlankPrompt(payload.userLevel, payload.focus, payload.count);

  const { exercises } = await callGroqForJSON<{ exercises: FillBlankExercise[] }>(
    systemPrompt,
    'Generate the exercises now.',
    { temperature: 0.75, max_tokens: 1000 },
  );

  return exercises;
}

// Purely local — no AI call needed to compare an answer we already generated
// alongside its explanation.
export function checkFillBlankAnswer(payload: FillBlankCheckRequest): FillBlankCheckResult {
  const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const correct = normalise(payload.userAnswer) === normalise(payload.exercise.correctAnswer);

  return {
    correct,
    correctAnswer: payload.exercise.correctAnswer,
    explanation: payload.exercise.explanation,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 8. AI FLASHCARDS (auto-generated from real learner content)
// ══════════════════════════════════════════════════════════════════════════
// Instead of a static deck, mine vocabulary out of conversations, roleplays,
// reading passages, or video transcripts the learner has actually engaged
// with — so review is always tied to something they've really encountered.
export async function generateFlashcardsFromContent(
  items: FlashcardSourceItem[],
  userLevel: WritingCorrectionRequest['userLevel'],
  count = 8,
): Promise<Flashcard[]> {
  const systemPrompt = buildFlashcardPrompt(userLevel, count);
  const userContent = JSON.stringify(
    items.map(i => ({ sourceType: i.sourceType, text: i.text.slice(0, 4000) })),
  );

  const { flashcards } = await callGroqForJSON<{ flashcards: Flashcard[] }>(
    systemPrompt,
    userContent,
    { temperature: 0.6, max_tokens: 1400 },
  );

  return flashcards;
}

/** Synthesizes audio for a single flashcard word — call lazily (e.g. on first flip), not for a whole deck at once, to stay within TTS rate limits. */
export async function synthesizeFlashcardAudio(word: string): Promise<Buffer> {
  return synthesizeSpeech(defaultTTSRequest(word));
}

// ══════════════════════════════════════════════════════════════════════════
// 9. VOCAB QUIZ — category-driven, audio-first, multiple choice
// ══════════════════════════════════════════════════════════════════════════
// Two active-recall question types built from a topic (not mined text):
//  - listening_choice: hear a word, pick which of 4 options was said
//  - sentence_completion: read a sentence with a blank, pick the word that fits
// Both come back with the wrong options already carrying an explanation, so
// the client can grade instantly without another round trip.
//
// AMBIGUITY FIX: for sentence_completion, many valid fills exist for a bare
// blank ("J'ai ___ kilos de pommes" — any plural number scans fine). Text
// alone often can't disambiguate a number/quantity answer. So the audio for
// sentence_completion is now synthesized from the SENTENCE WITH THE CORRECT
// ANSWER FILLED IN, not the blanked sentence — the same way listening_choice
// makes the audio authoritative. Previously we stripped the blank marker
// and left the number out entirely, so "Hear sentence" carried no
// disambiguating information at all. See buildVocabQuizPrompt for the
// matching prompt-side rule (forbid genuinely ambiguous blanks; treat
// audio as the source of truth for numbers/quantifiers).

const TOKENS_PER_QUESTION = 480;
const MAX_QUESTIONS_PER_CALL = 8; // keep each completion small enough to reliably finish without truncating mid-JSON

function chunkCount(total: number, size: number): number[] {
  const chunks: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const n = Math.min(size, remaining);
    chunks.push(n);
    remaining -= n;
  }
  return chunks;
}

export async function generateVocabQuiz(payload: VocabQuizRequest): Promise<VocabQuizResult> {
  const batches = chunkCount(payload.count, MAX_QUESTIONS_PER_CALL);

  // Sequential rather than Promise.all — avoids hammering a single Groq key
  // with several large parallel completions, and keeps a failed batch easy
  // to attribute in logs instead of one another.
  const batchResults: VocabQuizQuestion[] = [];
  for (const batchCount of batches) {
    const systemPrompt = buildVocabQuizPrompt(
      payload.userLevel,
      { category: payload.category, words: payload.words },
      payload.questionTypes,
      batchCount,
    );

    try {
      const { questions } = await callGroqForJSON<{ questions: VocabQuizQuestion[] }>(
        systemPrompt,
        'Generate the quiz now.',
        { temperature: 0.85, max_tokens: Math.min(8000, batchCount * TOKENS_PER_QUESTION + 400) },
      );
      batchResults.push(...questions);
    } catch (err) {
      console.error(`Vocab quiz batch of ${batchCount} failed to parse:`, err);
    }
  }

  if (batchResults.length === 0) {
    throw new AppError('Failed to generate vocab quiz — please try again', 502);
  }

  const withAudio = await Promise.all(
    batchResults.map(async (q) => {
      try {
        // Speak the CORRECT sentence, not the blanked one — this is what
        // actually lets the learner disambiguate a number/quantity answer
        // that reads as grammatically valid with multiple options. For
        // listening_choice, prompt already IS the word/phrase to say.
        const correctText = q.options.find(o => o.correct)?.text ?? '';
        const spokenText = q.type === 'sentence_completion' && correctText
          ? q.prompt.replace(/_+/g, correctText)
          : q.prompt;

        const audio = await synthesizeSpeech(defaultTTSRequest(spokenText));
        return { ...q, audioBase64: audio.length ? audio.toString('base64') : undefined };
      } catch {
        return q;
      }
    }),
  );

  return { questions: withAudio };
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════
export function getTutorConfig(): TutorConfig {
  return TUTOR_CONFIG;
}

export type { TutorConfig, RoleplayScene };