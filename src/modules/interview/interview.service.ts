import { supabase } from '../../config/supabase';
import { Errors } from '../../shared/errors';
import { groq } from '../../shared/groq.client';
import { buildPrompt } from './interview.prompt-builder';
import type {
  UserInterviewContextRow,
  UpsertContextBody,
  GetContextResponse,
  RespondResponse,
} from './interview.types';

interface SessionMemory {
  usedExperiences: string[];   // e.g. ["GHAFRA", "TiinaTii.io"]
  usedProofPoints: string[];   // e.g. ["70%", "6000+ utilisateurs"]
  answeredCategories: string[]; // e.g. ["behavioral", "motivation"]
  qaHistory: { question: string; answerSummary: string }[];
}

const sessionMemory = new Map<string, SessionMemory>();

function getMemory(userId: string): SessionMemory {
  if (!sessionMemory.has(userId)) {
    sessionMemory.set(userId, {
      usedExperiences: [],
      usedProofPoints: [],
      answeredCategories: [],
      qaHistory: [],
    });
  }
  return sessionMemory.get(userId)!;
}

export function clearMemory(userId: string) {
  sessionMemory.delete(userId);
}
// ─────────────────────────────────────────────────────────────
// Context Management
// ─────────────────────────────────────────────────────────────

export async function upsertContext(userId: string, body: UpsertContextBody): Promise<void> {
  const { error } = await supabase
    .from('user_interview_context')
    .upsert(
      {
        user_id:         userId,
        personal_info:   body.personalInfo   ?? null,
        cv_text:         body.cvText         ?? null,
        job_description: body.jobDescription ?? null,
        company_info:    body.companyInfo    ?? null,
        notes:           body.notes          ?? null,
        updated_at:      new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) throw Errors.internal('Failed to save interview context');
}

export async function getContext(userId: string): Promise<GetContextResponse> {
  const row = await getContextRowOrNull(userId);
  return {
    userId,
    personalInfo:   row?.personal_info   ?? null,
    cvText:         row?.cv_text         ?? null,
    jobDescription: row?.job_description ?? null,
    companyInfo:    row?.company_info    ?? null,
    notes:          row?.notes           ?? null,
  };
}

async function getContextRowOrNull(userId: string): Promise<UserInterviewContextRow | null> {
  const { data, error } = await supabase
    .from('user_interview_context')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw Errors.internal('Failed to fetch interview context');
  return data as UserInterviewContextRow | null;
}

// ─────────────────────────────────────────────────────────────
// Main Respond Function
// ─────────────────────────────────────────────────────────────

export async function respond(userId: string, text: string): Promise<RespondResponse> {
  const trimmed = text.trim();
  if (!trimmed) return { answer: '', isQuestion: false };

  const { reconstructed, isQuestion } = await reconstructAndClassify(trimmed);
  if (!isQuestion) return { answer: '', isQuestion: false };

  const memory = getMemory(userId);
  const context = await getContextRowOrNull(userId);
  const prompt = await buildPrompt(userId, context, reconstructed, memory);  // ← pass memory

  const answer = await groq.extractText(
    await groq.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.65,
      max_tokens: 600,
    }),
  );

  // Update memory after answering
  memory.qaHistory.push({
    question: reconstructed,
    answerSummary: answer.slice(0, 200), // store a truncated version
  });

  return { answer, isQuestion: true };
}

// ─────────────────────────────────────────────────────────────
// Reconstruct + Classify — single Groq call (was two calls)
// ─────────────────────────────────────────────────────────────

async function reconstructAndClassify(
  text: string,
): Promise<{ reconstructed: string; isQuestion: boolean }> {
  // Fast path — skip Groq entirely for obvious non-questions
  const fastResult = fastClassify(text);
  if (fastResult === false) return { reconstructed: text, isQuestion: false };

  // Fast path — obvious question markers, still reconstruct but skip LLM classify
  const looksLikeQuestion = fastResult === true;

  const res = await groq.chat({
    messages: [
      {
        role: 'user',
        content: `You are processing speech-to-text output from a job interview recording.

Task 1 — Fix transcription errors:
Correct phonetic/STT errors so the text reads as the interviewer likely intended.
Examples: "Palma un peu" → "Parlez-moi un peu", "présentay vous" → "présentez-vous"
Keep the original language (French stays French, English stays English).

Task 2 — Classify:
Decide if this is interview content the candidate should respond to.
Answer YES for: interview questions, prompts to speak, behavioural questions, technical questions.
Answer NO for: greetings only, small talk, admin ("can you hear me?"), farewells.

Respond in this exact format (two lines, nothing else):
CORRECTED: <corrected text>
IS_QUESTION: <YES or NO>

Input: "${text}"`,
      },
    ],
    temperature: 0.1,
    max_tokens: 160,
  });

  const raw = groq.extractText(res);
  const correctedMatch = raw.match(/CORRECTED:\s*(.+)/i);
  const isQuestionMatch = raw.match(/IS_QUESTION:\s*(YES|NO)/i);

  const reconstructed = correctedMatch?.[1]?.trim() || text;
  const llmSaysYes = (isQuestionMatch?.[1]?.toUpperCase() ?? 'NO') === 'YES';

  // If fast path already confirmed a question, trust it even if LLM disagrees
  const isQuestion = looksLikeQuestion || llmSaysYes;

  return { reconstructed, isQuestion };
}

// ─────────────────────────────────────────────────────────────
// Fast classifier — no Groq needed for clear-cut cases
// Returns true (definitely question), false (definitely not), null (needs LLM)
// ─────────────────────────────────────────────────────────────

function fastClassify(text: string): boolean | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4) return false;
  if (trimmed === '...' || trimmed === '…') return false;

  const lower = trimmed.toLowerCase();
  const clean = lower.replace(/[.,!?;:'"()]/g, ' ').trim();

  const greetingOnly = ['salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey'];
  if (greetingOnly.includes(clean)) return false;

  const hardExcludes = [
    'ça va', 'ca va', 'comment tu vas', 'comment vous allez',
    'bonne journée', 'au revoir', 'merci beaucoup', 'à bientôt',
    'ok merci', 'très bien', 'parfait', 'bonsoir tout le monde',
    'can you hear me', 'let me share', 'just a moment',
    'merci d\'avoir regardé', 'merci d\'avoir',
  ];
  if (hardExcludes.some(p => clean === p || clean.startsWith(p + ' '))) return false;

  if (trimmed.endsWith('?')) return true;

  const interviewOpeners = [
    'parlez', 'parle', 'présentez', 'présente', 'racontez', 'raconte',
    'décrivez', 'décris', 'expliquez', 'explique', 'donnez', 'donne',
    'pourquoi', 'comment', 'quand', 'où', 'qui', 'quelle', 'quelles',
    'quel', 'quels', 'est-ce que', 'est ce que', 'avez-vous', 'avez vous',
    'pouvez-vous', 'pouvez vous', 'êtes-vous', 'etes vous',
    'pensez-vous', 'pensez vous', 'dites', 'dis moi', 'dis-moi',
    'votre plus grand', 'votre principale', 'vos points',
    'dans cinq ans', 'dans 5 ans', 'forces', 'faiblesses',
    "qu'est-ce", 'qu est ce', 'que pensez', 'que ferez', 'que feriez',
    'parlez-moi', 'parle-moi', 'un peu de vous', 'si vous voulez',
    'tell me', 'describe', 'walk me', 'explain', 'give me',
    'what is', 'what are', 'what was', 'what were', 'what would',
    'how do', 'how did', 'how would', 'how have',
    'why did', 'why do', 'why would', 'why are',
    'can you', 'could you', 'would you', 'have you', 'do you', 'did you',
  ];
  if (interviewOpeners.some(o => clean.startsWith(o) || clean.includes(o))) return true;

  return null; // needs LLM
}

// ─────────────────────────────────────────────────────────────
// Transcription
// ─────────────────────────────────────────────────────────────

function normalizeMimeType(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase();

  if (mime.includes('wav')) return 'audio/wav';
  if (mime.includes('webm')) return 'audio/webm';
  if (mime.includes('ogg')) return 'audio/ogg';
  if (mime === 'audio/x-m4a' || mime.includes('m4a')) return 'audio/m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'audio/mpeg';
  if (mime.includes('mp4')) return 'audio/mp4';
  if (mime.includes('flac')) return 'audio/flac';

  return mime || 'audio/webm';
}

function mimeToFileName(mime: string): string {
  if (mime.includes('wav')) return 'recording.wav';
  if (mime.includes('webm')) return 'recording.webm';
  if (mime.includes('ogg')) return 'recording.ogg';
  if (mime.includes('m4a')) return 'recording.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'recording.mp3';
  if (mime.includes('mp4')) return 'recording.mp4';
  if (mime.includes('flac')) return 'recording.flac';
  return 'recording.webm';
}

export async function transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
  try {
    const fixedMime = normalizeMimeType(mimeType);

    console.log(`📢 Transcribe called | Size: ${(audioBuffer.length / 1024).toFixed(1)} KB | Mime: ${fixedMime}`);

    const formData = new FormData();
    const fileName = mimeToFileName(fixedMime);

    const safeBuffer = new Uint8Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.byteLength,
    );

    formData.append('file', new Blob([safeBuffer], { type: fixedMime }), fileName);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'fr');
    formData.append('response_format', 'json');

    const data = await groq.transcribe(formData);

    const text = data.text?.trim() ?? '';
    console.log(`✅ Transcription successful | Length: ${text.length} chars`);

    return text;
  } catch (err: any) {
    console.error('❌ Transcription failed:', err?.message || err);

    if (err?.message?.includes('413') || err?.message?.includes('payload')) {
      throw Errors.badRequest('Audio file too large');
    }
    if (err?.message?.includes('400')) {
      throw Errors.badRequest('Invalid audio format');
    }

    throw Errors.internal('Failed to transcribe audio');
  }
}

// ─────────────────────────────────────────────────────────────
// Translate
// Accepts optional answerText to batch question + answer in one Groq call
// ─────────────────────────────────────────────────────────────

export async function translate(
  text: string,
  answerText?: string,
): Promise<{ translation: string; answerTranslation?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { translation: '' };

  const looksEnglish = (t: string) =>
    !/[àâäéèêëîïôùûüçœæ]/i.test(t) &&
    !/\b(je|tu|il|nous|vous|ils|une|les|des|du|est|sont|avec|pour|dans|sur|par|que|qui|mais|ou|donc|ni|car)\b/i.test(t);

  const needsTranslation = !looksEnglish(trimmed);
  const answerNeedsTranslation = answerText?.trim() && !looksEnglish(answerText.trim());

  // Both already English — skip Groq entirely
  if (!needsTranslation && !answerNeedsTranslation) {
    return {
      translation: trimmed,
      answerTranslation: answerText?.trim() || undefined,
    };
  }

  const hasAnswer = Boolean(answerText?.trim() && answerNeedsTranslation);

  const content = hasAnswer
    ? `Translate the following two interview segments to natural English.
Output ONLY in this exact format (two lines, nothing else):
QUESTION: <translated question>
ANSWER: <translated answer>

Question segment: "${trimmed}"
Answer segment: "${answerText!.trim()}"`
    : `Translate the following interview segment to natural English.
Keep it concise and faithful. Output ONLY the translation, nothing else.

Segment: "${trimmed}"`;

  const res = await groq.chat({
    messages: [{ role: 'user', content }],
    temperature: 0.2,
    max_tokens: 500,
  });

  const raw = groq.extractText(res).trim();

  if (hasAnswer) {
    const qMatch = raw.match(/^QUESTION:\s*(.+)/im);
    const aMatch = raw.match(/^ANSWER:\s*(.+)/im);
    return {
      translation: qMatch?.[1]?.trim() || trimmed,
      answerTranslation: aMatch?.[1]?.trim() || answerText?.trim(),
    };
  }

  return {
    translation: raw || trimmed,
  };
}