import { supabase } from '../../config/supabase';
import { Errors } from '../../shared/errors';
import { groq } from '../../shared/groq.client';
import type {
  UserInterviewContextRow,
  UpsertContextBody,
  GetContextResponse,
  RespondResponse,
} from './interview.types';

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

  // Single Groq call: reconstruct garbled STT + classify as question in one shot
  const { reconstructed, isQuestion } = await reconstructAndClassify(trimmed);
  console.log('🔧 Reconstructed:', reconstructed);

  if (!isQuestion) {
    console.log('🤔 Not a question:', reconstructed);
    return { answer: '', isQuestion: false };
  }

  const context = await getContextRowOrNull(userId);
  const answer = await groq.extractText(
    await groq.chat({
      messages: [{ role: 'user', content: buildPrompt(context, reconstructed) }],
      temperature: 0.65,
      max_tokens: 600,
    }),
  );

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
// Prompt Builder
// ─────────────────────────────────────────────────────────────

function buildPrompt(context: UserInterviewContextRow | null, question: string): string {
  const cv       = context?.cv_text?.trim();
  const job      = context?.job_description?.trim();
  const company  = context?.company_info?.trim();
  const personal = context?.personal_info?.trim();
  const notes    = context?.notes?.trim();

  const uniqueTexts = new Set([cv, job, company].filter(Boolean));
  const allSame = uniqueTexts.size === 1;

  const contextBlock = allSame
    ? `Entreprise / Contexte: ${cv ?? 'Non fourni'}`
    : [
        personal ? `Profil personnel: ${personal}` : null,
        cv       ? `CV: ${cv}`                      : null,
        job      ? `Poste visé: ${job}`              : null,
        company  ? `Entreprise: ${company}`          : null,
        notes    ? `Notes: ${notes}`                 : null,
      ]
        .filter(Boolean)
        .join('\n');

  return `Tu es un coach d'entretien professionnel qui aide quelqu'un à répondre à des questions en temps réel.

Contexte disponible:
${contextBlock}

Question posée: "${question}"

Instructions:
- Réponds à la première personne, de façon naturelle et confiante
- Sois concis: 3 à 5 phrases maximum, pas de listes, pas de titres
- Si le CV est vide ou non pertinent, génère une réponse professionnelle générique mais crédible
- Adapte le ton selon la question (formel pour technique, humain pour comportemental)
- Réponds dans la même langue que la question`;
}

// ─────────────────────────────────────────────────────────────
// Transcription
// ─────────────────────────────────────────────────────────────

export async function transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const fixedMime = mimeType === 'audio/x-m4a' ? 'audio/m4a' : mimeType;

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: fixedMime });
  formData.append('file', blob, 'recording.wav');
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'fr');

  const data = await groq.transcribe(formData);
  return data.text?.trim() ?? '';
}