/**
 * french-ai.schema.ts
 */

import { z } from 'zod';

// ── Shared ────────────────────────────────────────────────────────────────────
export const CefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
export type CefrLevel = z.infer<typeof CefrLevelSchema>;

// ── Chat ──────────────────────────────────────────────────────────────────────
export const ChatMessageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string(),
});

export const ChatRequestSchema = z.object({
  messages:      z.array(ChatMessageSchema).min(1).max(50),
  mode:          z
    .enum(['conversation', 'correction', 'roleplay', 'pronunciation'])
    .default('conversation'),
  roleplayScene: z.string().optional(),
  userLevel:     CefrLevelSchema.default('A1'),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ── Chat response (for documentation / typed returns) ─────────────────────────
export interface ChatResponse {
  reply:       string;        // French reply
  translation: string;        // English translation
  correction:  string | null; // Grammar correction if any
  tip:         string | null; // Pronunciation / grammar tip
  suggestions: string[];      // 3 contextual follow-up phrases
  rawContent:  string;        // Full LLM output (debug)
}

// ── Transcription ─────────────────────────────────────────────────────────────
export const TranscribeQuerySchema = z.object({
  language: z.string().default('fr'),
});

export type TranscribeQuery = z.infer<typeof TranscribeQuerySchema>;

// ── TTS ───────────────────────────────────────────────────────────────────────
export const TTSRequestSchema = z.object({
  text:  z.string().min(1).max(500),
  speed: z.number().min(0.5).max(2.0).default(1.0),
  voice: z.string().default('fr-FR-Standard-A'),
});

export type TTSRequest = z.infer<typeof TTSRequestSchema>;

// Convenience builder for constructing a fully-formed TTSRequest from just
// text, using the same defaults the schema would apply on parse. Use this
// wherever the service needs to call synthesizeSpeech() without a request
// body already validated by TTSRequestSchema (e.g. dictation, flashcards).
export function defaultTTSRequest(text: string, overrides?: Partial<TTSRequest>): TTSRequest {
  return {
    text,
    speed: overrides?.speed ?? 1.0,
    voice: overrides?.voice ?? 'fr-FR-Standard-A',
  };
}

// ── Pronunciation Scoring ─────────────────────────────────────────────────────
export const PronunciationScoreRequestSchema = z.object({
  expectedText: z.string().min(1).max(300),
});

export type PronunciationScoreRequest = z.infer<typeof PronunciationScoreRequestSchema>;

// ══════════════════════════════════════════════════════════════════════════
// AI WRITING + INSTANT CORRECTION
// ══════════════════════════════════════════════════════════════════════════
export const WritingCorrectionRequestSchema = z.object({
  text:      z.string().min(1).max(3000),
  userLevel: CefrLevelSchema.default('A1'),
  context:   z.string().max(200).optional(),
});

export type WritingCorrectionRequest = z.infer<typeof WritingCorrectionRequestSchema>;

export interface WritingCorrectionResult {
  correctedText: string;
  mistakes: { original: string; correction: string; explanation: string }[];
  vocabularySuggestions: { original: string; suggestion: string; reason: string }[];
  naturalRewrite: string;
  cefrAssessment: {
    estimatedLevel: CefrLevel;
    strengths: string[];
    areasToImprove: string[];
  };
  overallFeedback: string;
}

// ══════════════════════════════════════════════════════════════════════════
// LISTENING & DICTATION
// ══════════════════════════════════════════════════════════════════════════
export const DictationPassageRequestSchema = z.object({
  userLevel:   CefrLevelSchema.default('A1'),
  topic:       z.string().max(100).optional(),
  lengthWords: z.number().int().min(5).max(100).optional(),
});

export type DictationPassageRequest = z.infer<typeof DictationPassageRequestSchema>;

export interface DictationPassage {
  text: string;
  /** base64-encoded audio (mp3/wav depending on which TTS backend served it) */
  audioBase64: string;
}

export const DictationCheckRequestSchema = z.object({
  originalText: z.string().min(1).max(1000),
  userAttempt:  z.string().min(1).max(1000),
  userLevel:    CefrLevelSchema.default('A1'),
});

export type DictationCheckRequest = z.infer<typeof DictationCheckRequestSchema>;

export interface DictationCheckResult {
  accuracyScore: number;
  wordDiff: {
    word: string;
    status: 'correct' | 'missing' | 'wrong' | 'extra';
    userWord?: string;
  }[];
  commonMistakeExplanations: string[];
  feedback: string;
}

// ══════════════════════════════════════════════════════════════════════════
// READING COMPREHENSION
// ══════════════════════════════════════════════════════════════════════════
export const ReadingExerciseRequestSchema = z.object({
  userLevel: CefrLevelSchema.default('A1'),
  topic:     z.string().max(100).optional(),
});

export type ReadingExerciseRequest = z.infer<typeof ReadingExerciseRequestSchema>;

export const ReadingQuestionSchema = z.object({
  id:            z.string(),
  type:          z.enum(['multiple_choice', 'short_answer', 'vocab_in_context', 'summary']),
  question:      z.string(),
  options:       z.array(z.string()).optional(),
  // TODO: correctAnswer currently round-trips through the client (no
  // persistence layer to stash it server-side). Fine for an MVP; if this
  // exercise type ever needs tamper-resistance, move answers into a
  // server-side cache (Redis/session) keyed by exercise id instead.
  correctAnswer: z.string().optional(),
});

export type ReadingQuestion = z.infer<typeof ReadingQuestionSchema>;

export const ReadingExerciseSchema = z.object({
  passage:         z.string(),
  vocabHighlights: z.array(z.object({ word: z.string(), meaning: z.string() })),
  questions:       z.array(ReadingQuestionSchema),
});

export type ReadingExercise = z.infer<typeof ReadingExerciseSchema>;

export const ReadingAnswerCheckRequestSchema = z.object({
  exercise:    ReadingExerciseSchema,
  userLevel:   CefrLevelSchema.default('A1'),
  userAnswers: z.record(z.string(), z.string()),
});

export type ReadingAnswerCheckRequest = z.infer<typeof ReadingAnswerCheckRequestSchema>;

export interface ReadingAnswerResult {
  results: { questionId: string; correct: boolean; feedback: string; modelAnswer?: string }[];
  overallScore: number;
  overallFeedback: string;
}

// ══════════════════════════════════════════════════════════════════════════
// FILL-IN-THE-BLANK / SENTENCE BUILDER
// ══════════════════════════════════════════════════════════════════════════
export const FillBlankFocusSchema = z.enum([
  'verb_tense', 'vocabulary', 'idiom', 'scrambled_sentence', 'mixed',
]);

export type FillBlankFocus = z.infer<typeof FillBlankFocusSchema>;

export const FillBlankRequestSchema = z.object({
  userLevel: CefrLevelSchema.default('A1'),
  focus:     FillBlankFocusSchema.default('mixed'),
  count:     z.number().int().min(1).max(10).default(5),
});

export type FillBlankRequest = z.infer<typeof FillBlankRequestSchema>;

export const FillBlankExerciseSchema = z.object({
  id:            z.string(),
  type:          z.enum(['fill_blank', 'scrambled', 'verb_tense', 'idiom']),
  prompt:        z.string(),
  options:       z.array(z.string()).optional(),
  // TODO: same caveat as ReadingQuestion.correctAnswer above — round-trips
  // through the client rather than being stashed server-side.
  correctAnswer: z.string(),
  explanation:   z.string(),
});

export type FillBlankExercise = z.infer<typeof FillBlankExerciseSchema>;

export const FillBlankCheckRequestSchema = z.object({
  exercise:   FillBlankExerciseSchema,
  userAnswer: z.string(),
});

export type FillBlankCheckRequest = z.infer<typeof FillBlankCheckRequestSchema>;

export interface FillBlankCheckResult {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

// ══════════════════════════════════════════════════════════════════════════
// AI FLASHCARDS
// ══════════════════════════════════════════════════════════════════════════
export const FlashcardSourceTypeSchema = z.enum(['conversation', 'roleplay', 'reading', 'video']);
export type FlashcardSourceType = z.infer<typeof FlashcardSourceTypeSchema>;

export const FlashcardSourceItemSchema = z.object({
  sourceType: FlashcardSourceTypeSchema,
  text:       z.string().min(1).max(8000),
});

export type FlashcardSourceItem = z.infer<typeof FlashcardSourceItemSchema>;

export const FlashcardGenerateRequestSchema = z.object({
  items:     z.array(FlashcardSourceItemSchema).min(1).max(10),
  userLevel: CefrLevelSchema.default('A1'),
  count:     z.number().int().min(1).max(20).default(8),
});

export type FlashcardGenerateRequest = z.infer<typeof FlashcardGenerateRequestSchema>;

export interface Flashcard {
  word: string;
  meaning: string;
  pronunciation: string;
  exampleSentence: string;
  exampleSentenceTranslation: string;
  followUpQuestion: string;
  sourceType: FlashcardSourceType;
}

export const FlashcardAudioRequestSchema = z.object({
  word: z.string().min(1).max(100),
});

export type FlashcardAudioRequest = z.infer<typeof FlashcardAudioRequestSchema>;

// ══════════════════════════════════════════════════════════════════════════
// VOCAB QUIZ — category-driven, audio-first, multiple choice
// ══════════════════════════════════════════════════════════════════════════
// Unlike Flashcards (which mine words out of text the learner already saw),
// a Vocab Quiz starts from a topic the learner picks — "Numbers", "Verbs",
// "Electrical Appliances", etc. — and produces two kinds of active-recall
// questions instead of passive flip cards:
//
//   - listening_choice:    audio plays a word/phrase; 4 options; pick which
//                           one was said (trains listening discrimination —
//                           e.g. seize/seize vs soixante/soixante-dix)
//   - sentence_completion: a sentence with a blank; 4 candidate words;
//                           pick the one that correctly completes it
//
// Grading is entirely client-side: each option already carries `correct`
// and (for the wrong ones) a `wrongExplanation`, so tapping an answer gives
// instant feedback with no extra round trip. Same tradeoff as
// ReadingQuestion/FillBlankExercise above — answers are visible in the
// network payload since there's no server-side session store yet.

export const VocabCategorySchema = z.enum([
  'numbers',              // cardinal/ordinal numbers, telling time, dates, years, weights & measures
  'electrical_appliances',
  'verbs',
  'adjectives',
  'food',
  'family',
  'travel',
  'colors',
  'custom',
]);

export type VocabCategory = z.infer<typeof VocabCategorySchema>;

export const VocabQuizQuestionTypeSchema = z.enum(['listening_choice', 'sentence_completion']);
export type VocabQuizQuestionType = z.infer<typeof VocabQuizQuestionTypeSchema>;

export const VocabQuizRequestSchema = z.object({
  // Either a preset category OR an explicit word list (e.g. reuse words
  // from a flashcard deck the learner just generated) — at least one required.
  category:      VocabCategorySchema.optional(),
  words:         z.array(z.string().min(1).max(60)).max(30).optional(),
  userLevel:     CefrLevelSchema.default('A1'),
  count:         z.number().int().min(1).max(15).default(6),
  questionTypes: z.array(VocabQuizQuestionTypeSchema).min(1)
    .default(['listening_choice', 'sentence_completion']),
}).refine(d => !!d.category || (d.words && d.words.length > 0), {
  message: 'Provide either a category or a non-empty list of words',
});

export type VocabQuizRequest = z.infer<typeof VocabQuizRequestSchema>;

export interface VocabQuizOption {
  id: string;
  text: string;
  correct: boolean;
  /** Shown only when the learner taps this option and it's wrong. Omitted for the correct option. */
  wrongExplanation?: string;
}

export interface VocabQuizQuestion {
  id: string;
  type: VocabQuizQuestionType;
  /** listening_choice: the word/phrase that gets spoken. sentence_completion: the sentence containing "___". */
  prompt: string;
  options: VocabQuizOption[];
  /** base64 audio of `prompt` being spoken — present for listening_choice, and for sentence_completion when useful for extra listening practice. */
  audioBase64?: string;
}

export interface VocabQuizResult {
  questions: VocabQuizQuestion[];
}

// ── Config ────────────────────────────────────────────────────────────────────
export interface RoleplayScene {
  label:       string;
  scene:       string;
  aiOpener:    string;
  suggestions: string[];
}

export interface TutorLevel {
  key:   string;
  label: string;
  // pronunciationPhrases removed from static config
}
export interface TutorConfig {
  levels:         TutorLevel[];
  roleplayScenes: RoleplayScene[];
}

export const ConfigQuerySchema = z.object({}).optional();