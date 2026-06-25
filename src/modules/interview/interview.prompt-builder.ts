import type { UserInterviewContextRow } from './interview.types';
import { CATEGORY_THEMES, type QuestionCategory } from './interview.classify';
import { getExtractedProfile, pickRelevantExperiences, type ExperienceTag } from './interview.experience';
import { INTERVIEW_SYSTEM_PROMPT, CATEGORY_STRUCTURE_BLOCKS } from './interview.prompt';

// ─────────────────────────────────────────────────────────────
// SessionMemory shape — must stay in sync with interview.service.ts
// ─────────────────────────────────────────────────────────────
// The prompt builder only reads memory; interview.service.ts writes it.
// We define a minimal read-side interface here so this file doesn't import
// from service.ts (which would create a circular dep).

export interface SessionMemory {
  usedExperiences: string[];
  usedProofPoints: string[];
  answeredCategories: string[];
  qaHistory: {
    question: string;
    anchorCompany: string | null;
    proofPointsCited: string[];
    angleSummary: string;
  }[];
}

export interface QuestionAnalysis {
  category: QuestionCategory;
  isCompound: boolean;
  focusHint: string;
  needsCompanyKnowledgeGap: boolean;
}

/**
 * Builds the final prompt sent to the LLM for a given question + user context.
 *
 * KEY CHANGES vs. previous version:
 *
 * 1. pickRelevantExperiences() now receives usedExperiences + usedProofPoints
 *    from structured session memory. The scorer applies a hard penalty to
 *    already-used experiences — this is MECHANICAL enforcement, not a soft
 *    text instruction.
 *
 * 2. buildMemoryBlock() now formats STRUCTURED memory (what company/angle was
 *    used per answer, which proof points were cited) rather than character-
 *    sliced answer text. The model gets clear, parseable "don't repeat" info
 *    instead of a truncated opener that only captured the first stat.
 */
export async function buildPrompt(
  userId: string,
  context: UserInterviewContextRow | null,
  question: string,
  analysis: QuestionAnalysis,
  memory?: SessionMemory,
  precomputedProfile?: Awaited<ReturnType<typeof getExtractedProfile>>,
): Promise<string> {
  const { category, focusHint } = analysis;

  const profile = precomputedProfile !== undefined
    ? precomputedProfile
    : await getExtractedProfile(userId, context);

  // Pass structured usage tracking into the scorer — mechanical dedup
  const relevant = profile
    ? pickRelevantExperiences(
        profile,
        CATEGORY_THEMES[category],
        category === 'self_intro' ? 1 : 2,
        memory?.usedExperiences ?? [],    // ← NEW: company-level penalty
        memory?.usedProofPoints ?? [],    // ← NEW: proof-point-level penalty
      )
    : [];

  const experienceBlock = relevant.length ? formatExperienceBlock(relevant) : '';
  const rawContextFallback = buildRawFallback(context, hasUsableProfile(profile));
  const memoryBlock = buildMemoryBlock(memory);

  const prompt = INTERVIEW_SYSTEM_PROMPT
    .replace('{{headline}}', profile?.headline?.trim() || '...')
    .replace('{{experienceBlock}}', experienceBlock)
    .replace('{{rawContextFallback}}', rawContextFallback)
    .replace('{{memoryBlock}}', memoryBlock)
    .replace('{{focusHint}}', focusHint || '')
    .replace('{{question}}', question.trim())
    .replace('{{category}}', category)
    .replace('{{structureBlock}}', CATEGORY_STRUCTURE_BLOCKS[category] ?? CATEGORY_STRUCTURE_BLOCKS.generic);

  return prompt;
}

// ─────────────────────────────────────────────────────────────
// Structured memory block — replaces character-sliced answer text
// ─────────────────────────────────────────────────────────────

function buildMemoryBlock(memory?: SessionMemory): string {
  if (!memory || memory.qaHistory.length === 0) return '';

  const usedCompanies = memory.usedExperiences.filter(Boolean);
  const usedPoints = memory.usedProofPoints.filter(Boolean);

  // Per-answer history: show the angle taken, not the raw text
  const historyLines = memory.qaHistory
    .map((h, i) => {
      const parts = [`Q${i + 1}: "${h.question}"`];
      if (h.anchorCompany) parts.push(`  → Ancre: ${h.anchorCompany}`);
      if (h.proofPointsCited.length) {
        parts.push(`  → Chiffres déjà cités: ${h.proofPointsCited.join(' · ')}`);
      }
      parts.push(`  → Angle: ${h.angleSummary}`);
      return parts.join('\n');
    })
    .join('\n\n');

  // Global summary at the top — makes it easy for the model to see at a glance
  // what's off-limits without reading every history entry
  const globalSummary: string[] = [];
  if (usedCompanies.length) {
    globalSummary.push(`Expériences déjà utilisées comme ancre: ${usedCompanies.join(', ')}`);
  }
  if (usedPoints.length) {
    globalSummary.push(`Chiffres/preuves déjà cités: ${usedPoints.join(' · ')}`);
  }

  return `═══════════════════════════════
HISTORIQUE DE CET ENTRETIEN — NE PAS RÉPÉTER
═══════════════════════════════
${globalSummary.length ? globalSummary.join('\n') + '\n\n' : ''}RÈGLE STRICTE:
- Si une expérience est listée ci-dessus comme "déjà utilisée", choisis une expérience DIFFÉRENTE pour ancrer cette réponse.
- Si tous les chiffres d'une expérience ont déjà été cités, utilise cette expérience sous un angle différent OU choisis une autre expérience.
- Jamais deux réponses de suite avec la même entreprise, le même chiffre ou la même structure d'ouverture.

Détail des réponses précédentes:
${historyLines}`;
}

// ─────────────────────────────────────────────────────────────
// Formatting helpers (unchanged from original)
// ─────────────────────────────────────────────────────────────

function hasUsableProfile(profile: { experiences: ExperienceTag[] } | null): boolean {
  return Boolean(profile && profile.experiences.length > 0);
}

function formatExperienceBlock(experiences: ExperienceTag[]): string {
  const blocks = experiences.map(exp => {
    const period = exp.period ? ` (${exp.period})` : '';
    const proof = exp.proofPoints.length ? `\n  Preuves concrètes: ${exp.proofPoints.join(' · ')}` : '';
    const stack = exp.stack.length ? `\n  Stack: ${exp.stack.join(', ')}` : '';
    const strengths = exp.strengths.length ? `\n  Pertinent pour: ${exp.strengths.join(', ')}` : '';
    return `• ${exp.company} — ${exp.role}${period}${proof}${stack}${strengths}`;
  });

  return [
    'EXPÉRIENCE(S) À PRIVILÉGIER POUR CETTE QUESTION (sélectionnée(s) automatiquement comme la meilleure preuve disponible):',
    ...blocks,
    '',
    'Utilise en priorité cette expérience pour ancrer la réponse. Ne mentionne les autres expériences du candidat que si elles sont strictement nécessaires.',
  ].join('\n');
}

function buildRawFallback(context: UserInterviewContextRow | null, profileIsUsable: boolean): string {
  const cv = context?.cv_text?.trim();
  const job = context?.job_description?.trim();
  const company = context?.company_info?.trim();
  const personal = context?.personal_info?.trim();
  const notes = context?.notes?.trim();

  if (!cv && !job && !company && !personal && !notes) {
    return profileIsUsable
      ? ''
      : 'Aucun contexte fourni — génère une réponse professionnelle générique mais crédible pour un développeur junior, sans inventer de fait précis.';
  }

  const label = profileIsUsable
    ? "CONTEXTE BRUT COMPLÉMENTAIRE (utiliser seulement si utile en plus de l'expérience ci-dessus — ne pas réutiliser ce qui est déjà couvert au-dessus):"
    : 'CONTEXTE DU CANDIDAT (extraction structurée indisponible — utilise ce texte brut directement):';

  const parts = [
    job ? `Poste visé: ${job}` : null,
    company ? `Entreprise/École cible: ${company}` : null,
    !profileIsUsable && cv ? `CV: ${cv}` : null,
    !profileIsUsable && personal ? `Profil personnel: ${personal}` : null,
    notes ? `Notes additionnelles: ${notes}` : null,
  ].filter(Boolean);

  if (!parts.length) return '';

  return [label, ...parts].join('\n');
}