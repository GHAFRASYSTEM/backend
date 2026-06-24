import type { UserInterviewContextRow } from './interview.types';
import { classifyQuestion, CATEGORY_THEMES, type QuestionCategory } from './interview.classify'
import { getExtractedProfile, pickRelevantExperiences, type ExperienceTag } from './interview.experience';
import { INTERVIEW_SYSTEM_PROMPT, CATEGORY_STRUCTURE_BLOCKS } from './interview.prompt';
export interface SessionMemory {
  qaHistory: { question: string; answerSummary: string }[];
}


/**
 * Builds the final prompt sent to the LLM for a given question + user context.
 * Replaces the old flat buildPrompt(). Async now (profile extraction may
 * hit Groq once per CV-version, cached afterwards — see interview.experiences.ts).
 */
export async function buildPrompt(
  userId: string,
  context: UserInterviewContextRow | null,
  question: string,
  memory?: SessionMemory,
): Promise<string> {
  const analysis = await classifyQuestion(question);
  const { category, focusHint } = analysis;

  const profile = await getExtractedProfile(userId, context);
  const relevant = profile
    ? pickRelevantExperiences(profile, CATEGORY_THEMES[category], category === 'self_intro' ? 1 : 2)
    : [];

  const experienceBlock = relevant.length ? formatExperienceBlock(relevant) : '';
  const rawContextFallback = buildRawFallback(context, hasUsableProfile(profile));
  const memoryBlock = buildMemoryBlock(memory);  // ← new

let prompt = INTERVIEW_SYSTEM_PROMPT
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

function buildMemoryBlock(memory?: SessionMemory): string {
  if (!memory || memory.qaHistory.length === 0) return '';

  const history = memory.qaHistory
    .map((h, i) => `Q${i + 1}: "${h.question}"\nRéponse donnée (résumé): ${h.answerSummary}`)
    .join('\n\n');

  return `═══════════════════════════════
HISTORIQUE DE CET ENTRETIEN (NE PAS RÉPÉTER)
═══════════════════════════════
Les réponses suivantes ont déjà été données durant cet entretien.
Tu DOIS varier: utiliser une expérience différente, un angle différent, des mots différents.
Ne jamais répéter un chiffre ou une réalisation déjà citée sauf si c'est la seule disponible.

${history}`;
}

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
    ? 'CONTEXTE BRUT COMPLÉMENTAIRE (utiliser seulement si utile en plus de l\'expérience ci-dessus — ne pas réutiliser ce qui est déjà couvert au-dessus):'
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