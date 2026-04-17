/**
 * french-ai.schema.ts
 */

import { z } from 'zod';

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
  userLevel:     z.enum(['A1', 'A2', 'B1', 'B2','C1','C2']).default('A1'),
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

// ── Pronunciation Scoring ─────────────────────────────────────────────────────
export const PronunciationScoreRequestSchema = z.object({
  expectedText: z.string().min(1).max(300),
});

export type PronunciationScoreRequest = z.infer<typeof PronunciationScoreRequestSchema>;

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