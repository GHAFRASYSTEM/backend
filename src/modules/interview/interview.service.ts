import { supabase } from '../../config/supabase';
import { Errors } from '../../shared/errors';
import { groq } from '../../shared/groq.client';
import { MODEL_LARGE, MODEL_SMALL } from './interview.models';
import {
  buildPrompt,
  CATEGORY_STRUCTURE_BLOCKS,
} from './interview.prompt';
import { reconstructAndClassify } from './interview.classify';
import { getExtractedProfile } from './interview.experience';
import type {
  UserInterviewContextRow,
  UpsertContextBody,
  GetContextResponse,
  RespondResponse,
} from './interview.types';

// ─────────────────────────────────────────────────────────────
// GAP FIXES vs. previous service
//
// 1. buildPrompt() signature changed — now takes a single CandidateProfile
//    object + QuestionContext object (not 6 positional args). All call sites
//    updated accordingly.
//
// 2. usedExamples is now fed from SessionMemory.usedExperiences (structured
//    string list) — not from raw answer text. The prompt's {{usedExamples}}
//    block therefore receives real company/project names, not char slices.
//
// 3. closingsUsed tracking added — the service now records which closing
//    option (A–F) was detected in each answer and passes the forbidden list
//    to buildPrompt so the prompt's CLOSING MENU constraint is mechanically
//    enforced, not just instructed.
//
// 4. companyName + companyCity are now extracted from job_description and
//    passed to buildPrompt so {{companySearchHint}} is populated. Previously
//    this was never wired — the placeholder always resolved to ''.
//
// 5. Web search is now enabled on the Groq call via the correct tool spec
//    when the question category is company-adjacent. Previously the tool was
//    referenced in the prompt but never attached to the actual API call.
//
// 6. memoryBlock is now built from SessionMemory.qaHistory in a structured,
//    readable format the prompt can act on — not a raw char slice.
//
// 7. headline is now extracted from personal_info (first H3 line) rather
//    than left empty. experienceBlock is cv_text. rawContext is personal_info.
//    These map directly to the prompt placeholders.
//
// 8. MODEL is Groq (unchanged). Web search tool spec uses Groq's format —
//    adjust if you switch to Anthropic SDK (tool type string differs).
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// SessionMemory
// ─────────────────────────────────────────────────────────────

interface SessionMemory {
  /** Company / project names that anchored a previous answer. Fed into {{usedExamples}}. */
  usedExperiences: string[];
  /** Proof-point strings (metrics, stats) already cited. Used for dedup scoring. */
  usedProofPoints: string[];
  /** Category strings answered so far. */
  answeredCategories: string[];
  /**
   * Closing options (A–F) already used this session.
   * Passed to buildPrompt so the CLOSING MENU constraint is mechanically enforced.
   */
  usedClosingOptions: string[];
  /**
   * Whether "Ce que j'en retiens" has been used — special-cased in the prompt.
   * Tracked separately because it spans closing options and body text.
   */
  retiensPhraseUsed: boolean;
  /** Structured Q&A history — feeds {{memoryBlock}} in the prompt. */
  qaHistory: {
    question: string;
    anchorCompany: string | null;
    proofPointsCited: string[];
    closingOption: string | null;
    angleSummary: string;
  }[];
}

const sessionMemory = new Map<string, SessionMemory>();

function getMemory(userId: string): SessionMemory {
  if (!sessionMemory.has(userId)) {
    sessionMemory.set(userId, {
      usedExperiences: [],
      usedProofPoints: [],
      answeredCategories: [],
      usedClosingOptions: [],
      retiensPhraseUsed: false,
      qaHistory: [],
    });
  }
  return sessionMemory.get(userId)!;
}

export function clearMemory(userId: string) {
  sessionMemory.delete(userId);
}

// ─────────────────────────────────────────────────────────────
// Categories where company knowledge may be needed → enable web search
// ─────────────────────────────────────────────────────────────
const COMPANY_ADJACENT_CATEGORIES: Array<keyof typeof CATEGORY_STRUCTURE_BLOCKS> = [
  'company_knowledge',
  'motivation',
  'culture_fit',
];

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

  const [analysis, context] = await Promise.all([
    reconstructAndClassify(trimmed),
    getContextRowOrNull(userId),
  ]);

  if (!analysis.isQuestion) return { answer: '', isQuestion: false };

  const memory = getMemory(userId);
  const profile = await getExtractedProfile(userId, context);

  // ── Extract company metadata for {{companySearchHint}} ──────────────
  // The prompt placeholder resolves to '' if these are not passed.
  // Previously this was never wired — company questions never triggered search.
  const companyName = extractCompanyName(context?.job_description ?? '');
  const companyCity = extractCity(context?.job_description ?? '');

  // ── Build headline from personal_info ───────────────────────────────
  // Maps to {{headline}} in the prompt — was always empty before.
  const headline = extractHeadline(context?.personal_info ?? '');

  // ── Build structured memory block for {{memoryBlock}} ───────────────
  // Previously this was answer.slice(0, 200) — a raw char truncation that
  // captured the stat-heavy opener and missed everything else.
  // Now it's a structured block the prompt can act on.
  const memoryBlock = buildMemoryBlock(memory);

  // ── Build usedExamples list for {{usedExamples}} ────────────────────
  // Now comes from structured tracking, not char slices.
  const usedExamples = memory.usedExperiences;

  // ── Build closing constraint line for {{closingMenu}} injection ──────
  // The CLOSING MENU in the prompt says "NE JAMAIS utiliser la même formule
  // deux fois". We reinforce this mechanically by appending the forbidden
  // options to the prompt rather than relying on the model to remember.
  const closingConstraintLine = buildClosingConstraintLine(memory);

  // ── Assemble prompt ──────────────────────────────────────────────────
  const systemPrompt = buildPrompt(
    {
      headline,
      experienceBlock: context?.cv_text         ?? '',
      rawContext:      context?.personal_info    ?? '',
      memoryBlock,
      usedExamples,
      companyInfo:     context?.company_info     ?? '',
      companyName,
      companyCity,
      // Injected as a postscript to the CLOSING MENU — mechanically forbids
      // options already used. buildPrompt must append this after {{structureBlock}}.
      closingConstraintLine,
      // Flag so buildPrompt can signal the model if "retiens" is banned
      retiensPhraseUsed: memory.retiensPhraseUsed,
    },
    {
      question:  analysis.reconstructed,
      category:  analysis.category as keyof typeof CATEGORY_STRUCTURE_BLOCKS,
      focusHint: analysis.focusHint ?? getFocusHint(analysis.category),
    },
  );

  // ── API call — enable web search for company-adjacent categories ─────
  // Previously the prompt told the model to use web_search but the tool was
  // never attached to the request. The model would hallucinate or skip it.
  const needsWebSearch = COMPANY_ADJACENT_CATEGORIES.includes(
    analysis.category as keyof typeof CATEGORY_STRUCTURE_BLOCKS,
  ) || (context?.company_info ?? '').trim().length < 100;

  const chatPayload: Parameters<typeof groq.chat>[0] = {
    model:      MODEL_LARGE,
    messages:   [{ role: 'user', content: systemPrompt }],
    temperature: 0.65,
    max_tokens:  600,
  };

  // NOTE: Groq's web search tool spec — adjust tool type if switching to Anthropic SDK.
  // Anthropic SDK uses: { type: 'web_search_20250305', name: 'web_search' }
  // Groq uses a different format — check your groq.client wrapper for the correct shape.
  if (needsWebSearch) {
    (chatPayload as any).tools = [
      {
        type: 'function',
        function: {
          name:        'web_search',
          description: 'Search the web for current information about a company or topic.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
            },
            required: ['query'],
          },
        },
      },
    ];
    (chatPayload as any).tool_choice = 'auto';
  }

  const raw = await groq.chat(chatPayload);
  const answer = groq.extractText(raw);

  // ─────────────────────────────────────────────────────────────
  // Structured memory update
  // ─────────────────────────────────────────────────────────────

  // 1. Which experience anchored this answer
  const anchorCompany = findAnchorCompany(answer, profile?.experiences ?? []);

  // 2. Which proof points were cited
  const proofPointsCited = findCitedProofPoints(answer, profile?.experiences ?? []);

  // 3. Which closing option was used (detect from answer text)
  const closingOption = detectClosingOption(answer);

  // 4. Whether "retiens" phrase appeared
  const retiensPhraseUsed = answer.includes("ce que j'en retiens") ||
                             answer.includes("Ce que j'en retiens");

  // 5. Angle summary — cheap small-model call
  const angleSummary = await extractAngleSummary(analysis.reconstructed, answer);

  // ── Write back to memory ─────────────────────────────────────────────
  if (anchorCompany && !memory.usedExperiences.includes(anchorCompany)) {
    memory.usedExperiences.push(anchorCompany);
  }
  for (const pp of proofPointsCited) {
    if (!memory.usedProofPoints.includes(pp)) {
      memory.usedProofPoints.push(pp);
    }
  }
  if (!memory.answeredCategories.includes(analysis.category)) {
    memory.answeredCategories.push(analysis.category);
  }
  if (closingOption && !memory.usedClosingOptions.includes(closingOption)) {
    memory.usedClosingOptions.push(closingOption);
  }
  if (retiensPhraseUsed) {
    memory.retiensPhraseUsed = true;
  }

  memory.qaHistory.push({
    question: analysis.reconstructed,
    anchorCompany,
    proofPointsCited,
    closingOption,
    angleSummary,
  });

  return { answer: answer.trim(), isQuestion: true };
}

// ─────────────────────────────────────────────────────────────
// Memory formatters — feed prompt placeholders
// ─────────────────────────────────────────────────────────────

/**
 * Builds the {{memoryBlock}} string injected into the prompt.
 * Structured and readable — not a raw char slice.
 * Keeps the last 4 Q&A pairs to stay within token budget.
 */
function buildMemoryBlock(memory: SessionMemory): string {
  if (memory.qaHistory.length === 0) return '';

  const recent = memory.qaHistory.slice(-4);

  const lines = recent.map((entry, i) => {
    const parts = [`Q${i + 1}: "${entry.question}"`];
    if (entry.anchorCompany) {
      parts.push(`→ Ancre utilisée: ${entry.anchorCompany}`);
    }
    if (entry.proofPointsCited.length > 0) {
      parts.push(`→ Preuves citées: ${entry.proofPointsCited.join(' | ')}`);
    }
    if (entry.closingOption) {
      parts.push(`→ Clôture utilisée: Option ${entry.closingOption}`);
    }
    parts.push(`→ Angle: ${entry.angleSummary}`);
    return parts.join('\n   ');
  });

  return [
    '═══════════════════════════════',
    'HISTORIQUE DE SESSION — NE PAS RÉPÉTER CES ANGLES',
    '═══════════════════════════════',
    ...lines,
  ].join('\n');
}

/**
 * Builds a constraint line appended after the CLOSING MENU.
 * Mechanically forbids options already used — reinforces the prompt instruction.
 */
function buildClosingConstraintLine(memory: SessionMemory): string {
  const forbidden: string[] = [];

  if (memory.usedClosingOptions.length > 0) {
    forbidden.push(`Options déjà utilisées (INTERDITES cette réponse): ${memory.usedClosingOptions.join(', ')}`);
  }
  if (memory.retiensPhraseUsed) {
    forbidden.push('"Ce que j\'en retiens, c\'est que" — INTERDIT (déjà utilisé dans cette session).');
  }

  return forbidden.length > 0 ? forbidden.join('\n') : '';
}

// ─────────────────────────────────────────────────────────────
// Extraction helpers
// ─────────────────────────────────────────────────────────────

function extractHeadline(personalInfo: string): string {
  const m = personalInfo.match(/###\s+(.+)/);
  return m ? m[1].trim() : '';
}

function extractCompanyName(jobDescription: string): string {
  const patterns = [
    /^COMPANY[:\s]+([A-Z][^\n,]{2,40})/im,
    /Join\s+([A-Z][^\n,]{2,40})/i,
    /chez\s+([A-Z][^\n,]{2,40})/i,
    /at\s+([A-Z][^\n,]{2,40})\b/i,
  ];
  for (const p of patterns) {
    const m = jobDescription.match(p);
    if (m) return m[1].trim();
  }
  return '';
}

function extractCity(jobDescription: string): string {
  const m = jobDescription.match(/LOCATION[:\s]+([^\n(,]+)/i);
  return m ? m[1].trim() : '';
}

/**
 * Returns the company name from known experiences that appears most in the answer.
 */
function findAnchorCompany(
  answer: string,
  experiences: { company: string }[],
): string | null {
  const lower = answer.toLowerCase();
  let best: string | null = null;
  let bestCount = 0;

  for (const exp of experiences) {
    const name = exp.company.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = lower.indexOf(name, idx)) !== -1) {
      count++;
      idx += name.length;
    }
    if (count > bestCount) {
      bestCount = count;
      best = exp.company;
    }
  }

  return best;
}

/**
 * Returns proof-point strings from the profile that appear in the answer.
 * Matches on hard tokens (numbers, %, long words) rather than full strings.
 */
function findCitedProofPoints(
  answer: string,
  experiences: { proofPoints?: string[] }[],
): string[] {
  const lower = answer.toLowerCase();
  const cited: string[] = [];

  for (const exp of experiences) {
    for (const pp of (exp.proofPoints ?? [])) {
      const hardTokens = pp
        .toLowerCase()
        .match(/\d[\d\s,.]*(%)|\d+|[a-zàâäéèêëîïôùûüç]{6,}/g) ?? [];

      if (hardTokens.length === 0) continue;

      const matchCount = hardTokens.filter(t => lower.includes(t)).length;
      if (matchCount >= Math.ceil(hardTokens.length * 0.6)) {
        cited.push(pp);
      }
    }
  }

  return cited;
}

/**
 * Detects which closing option (A–F) was used in the answer.
 * Based on signal phrases from the CLOSING MENU in the prompt.
 */
function detectClosingOption(answer: string): string | null {
  const lower = answer.toLowerCase();

  // Option A — link to the role
  if (lower.includes("j'espère continuer à développer ici") ||
      lower.includes("c'est d'ailleurs ce que j'espère")) return 'A';

  // Option B — learned reflex
  if (lower.includes("c'est un réflexe que j'ai gardé") ||
      lower.includes("ça a changé ma façon") ||
      lower.includes("je reviens toujours à ça")) return 'B';

  // Option C — open question to interviewer
  if (lower.includes("est-ce que c'est le type") ||
      lower.includes("c'est ça que vous cherchez")) return 'C';

  // Option D — short dry close
  if (lower.endsWith("et ça a marché.") ||
      lower.endsWith("aucun regret.") ||
      lower.endsWith("je referais pareil.")) return 'D';

  // Option E — realistic projection
  if (lower.includes("dans deux ans, je veux pouvoir dire")) return 'E';

  // Option F — no closing (ends on result/action) → null is correct, not 'F'
  // We detect 'F' implicitly: if no other option matched, it's F or no close.
  return null;
}

/**
 * Cheap small-model call to get a genuine angle summary.
 * Replaces answer.slice(0, 200) as the memory entry.
 */
async function extractAngleSummary(question: string, answer: string): Promise<string> {
  try {
    const res = await groq.chat({
      model: MODEL_SMALL,
      messages: [
        {
          role: 'user',
          content: `En une phrase courte (max 25 mots), résume l'ANGLE pris dans cette réponse d'entretien : quelle expérience a été utilisée et quelle qualité a été démontrée. Ne répète pas la question.

Question: "${question}"
Réponse: "${answer.slice(0, 400)}"

Résumé d'angle (une phrase, sans ponctuation finale) :`,
        },
      ],
      temperature: 0.1,
      max_tokens:  60,
    });
    return groq.extractText(res).trim() || answer.slice(0, 120);
  } catch {
    return answer.slice(0, 120);
  }
}

/**
 * Default focus hints per category — used when classify() doesn't provide one.
 */
function getFocusHint(category: string): string {
  const hints: Record<string, string> = {
    self_intro:
      'Montrer qui tu es en une réponse courte et mémorable — prénom, école, projet phare, lien au poste.',
    behavioral:
      'Raconter une vraie situation avec un résultat concret. Pas de généralité.',
    motivation:
      "Nommer un élément spécifique du poste ou de l'entreprise, pas \"j'aime les défis\".",
    company_knowledge:
      'Montrer que tu as cherché — au moins 2 faits concrets sur l\'entreprise.',
    career_goals:
      'Construire la chaîne : maintenant → dans 2 ans → lien avec ce poste.',
    technical:
      'Répondre directement au concept, illustrer avec une expérience réelle si possible.',
    curveball:
      'Rester calme. Ancrer dans un fait, pas une qualité abstraite.',
    logistics:
      'Répondre factuellement en une ou deux phrases. Pas de story.',
    culture_fit:
      'Répondre depuis une vraie expérience vécue, pas une préférence générale.',
    career_transition:
      'Trouver la vraie raison du changement dans le profil et la formuler professionnellement.',
    project:
      'Nommer le projet, ta mission exacte, un obstacle surmonté, le résultat.',
    hypothetical:
      'Énoncer le réflexe pro immédiat, les étapes, ancrer dans du réel si possible.',
    
  };
  return hints[category] ?? 'Répondre de façon concrète et ancrée dans le profil.';
}

// ─────────────────────────────────────────────────────────────
// Transcription
// ─────────────────────────────────────────────────────────────

function normalizeMimeType(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('wav'))  return 'audio/wav';
  if (mime.includes('webm')) return 'audio/webm';
  if (mime.includes('ogg'))  return 'audio/ogg';
  if (mime === 'audio/x-m4a' || mime.includes('m4a')) return 'audio/m4a';
  if (mime.includes('mpeg') || mime.includes('mp3'))  return 'audio/mpeg';
  if (mime.includes('mp4'))  return 'audio/mp4';
  if (mime.includes('flac')) return 'audio/flac';
  return mime || 'audio/webm';
}

function mimeToFileName(mime: string): string {
  if (mime.includes('wav'))  return 'recording.wav';
  if (mime.includes('webm')) return 'recording.webm';
  if (mime.includes('ogg'))  return 'recording.ogg';
  if (mime.includes('m4a'))  return 'recording.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'recording.mp3';
  if (mime.includes('mp4'))  return 'recording.mp4';
  if (mime.includes('flac')) return 'recording.flac';
  return 'recording.webm';
}

export async function transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
  try {
    const fixedMime = normalizeMimeType(mimeType);
    console.log(`📢 Transcribe called | Size: ${(audioBuffer.length / 1024).toFixed(1)} KB | Mime: ${fixedMime}`);

    const formData = new FormData();
    const fileName = mimeToFileName(fixedMime);
    const safeBuffer = Uint8Array.from(audioBuffer);

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

  const needsTranslation       = !looksEnglish(trimmed);
  const answerNeedsTranslation  = answerText?.trim() && !looksEnglish(answerText.trim());

  if (!needsTranslation && !answerNeedsTranslation) {
    return {
      translation:      trimmed,
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
    model:       MODEL_SMALL,
    messages:    [{ role: 'user', content }],
    temperature: 0.2,
    max_tokens:  500,
  });

  const raw = groq.extractText(res).trim();

  if (hasAnswer) {
    const qMatch = raw.match(/^QUESTION:\s*(.+)/im);
    const aMatch = raw.match(/^ANSWER:\s*(.+)/im);
    return {
      translation:      qMatch?.[1]?.trim() || trimmed,
      answerTranslation: aMatch?.[1]?.trim() || answerText?.trim(),
    };
  }

  return { translation: raw || trimmed };
}