import type { UserInterviewContextRow } from './interview.types';
import { groq } from '../../shared/groq.client';

// ─────────────────────────────────────────────────────────────
// Why this file exists
// ─────────────────────────────────────────────────────────────
// The raw CV text mentions multiple companies/projects (HostelHubb, Ghafra,
// TiinaTii, freelance work, etc). Dumping all of it into the prompt as one
// blob means the model has no way to know WHICH experience best supports
// WHICH kind of question — it either blends them or picks generically.
//
// This module extracts a small structured list of "experiences" from the
// CV/personal_info text, each tagged with what it's strongest evidence for
// (leadership, technical depth, AI/automation, payments, UX, scale/metrics...).
// The prompt builder then surfaces only the 1-2 most relevant experiences
// for the specific question being asked, with their concrete metrics intact.
//
// USAGE PENALTY (new):
// pickRelevantExperiences() now accepts a `usedExperiences` set. Any
// experience already used this session takes a hard score penalty, so the
// scorer will always prefer an unused experience with the same theme match
// before falling back to a repeated one. This is MECHANICAL enforcement —
// not a soft text instruction the model can ignore.

export interface ExperienceTag {
  company: string;
  role: string;
  period: string | null;
  /** What this experience is the strongest evidence for. Free-form, derived from content. */
  strengths: string[];
  /** Concrete, quotable proof points (metrics, scale, tech) — kept verbatim from CV where possible. */
  proofPoints: string[];
  /** Tech stack mentioned for this specific experience. */
  stack: string[];
}

export interface ExtractedProfile {
  experiences: ExperienceTag[];
  /** Cheap signal for "tell me about yourself" — order of priority/recency as the candidate would lead with. */
  headline: string;
}

const CACHE = new Map<string, { hash: string; profile: ExtractedProfile }>();

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Extracts and tags experiences from the CV/personal_info text.
 * Cached per-user, invalidated automatically if the underlying text changes.
 */
export async function getExtractedProfile(
  userId: string,
  context: UserInterviewContextRow | null,
): Promise<ExtractedProfile | null> {
  const sourceText = [context?.cv_text, context?.personal_info].filter(Boolean).join('\n---\n');
  if (!sourceText.trim()) return null;

  const hash = simpleHash(sourceText);
  const cached = CACHE.get(userId);
  if (cached && cached.hash === hash) return cached.profile;

  const profile = await extractProfile(sourceText);
  CACHE.set(userId, { hash, profile });
  return profile;
}

async function extractProfile(sourceText: string): Promise<ExtractedProfile> {
  const res = await groq.chat({
    messages: [
      {
        role: 'user',
        content: `Tu analyses un CV/profil de candidat pour un coach d'entretien IA. Extrait chaque expérience professionnelle distincte (entreprise, stage, startup, freelance) et tague-la avec ce pour quoi elle est la MEILLEURE preuve.

Réponds UNIQUEMENT en JSON valide, ce format exact, rien d'autre:
{
  "headline": "une phrase qui résume le candidat pour une intro 'parlez-moi de vous'",
  "experiences": [
    {
      "company": "nom entreprise/projet",
      "role": "intitulé du poste",
      "period": "période ou null",
      "strengths": ["leadership", "technique", "produit", "scale", "paiement", "IA", "UX", "autonomie", "..."],
      "proofPoints": ["métrique ou fait concret et chiffré tiré du texte", "..."],
      "stack": ["techno1", "techno2"]
    }
  ]
}

Règles:
- "strengths" doit décrire CE POUR QUOI cette expérience est la preuve la plus forte (ex: une startup fondée par le candidat = forte preuve de "leadership"/"autonomie"/"produit"; un projet avec chatbot IA = forte preuve de "IA"/"intégration technique"; un projet avec paiement Stripe = forte preuve de "paiement"/"UX bout-en-bout").
- "proofPoints" doit reprendre les chiffres et faits EXACTS du texte (utilisateurs, %, partenaires, délais) — ne rien inventer.
- N'invente AUCUNE expérience, entreprise ou métrique absente du texte.
- Si une info est absente, omets le champ ou mets null.

Texte source:
"""
${sourceText}
"""`,
      },
    ],
    temperature: 0.1,
    max_tokens: 900,
  });

  const raw = groq.extractText(res).trim();
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as ExtractedProfile;
    if (!Array.isArray(parsed.experiences)) throw new Error('bad shape');
    return parsed;
  } catch {
    // Fail soft — prompt builder treats null profile as "no structured data, fall back to raw text"
    return { headline: '', experiences: [] };
  }
}

/**
 * Picks the most relevant experiences for a given question, ranked by
 * overlap between the question's implied theme and each experience's tags.
 *
 * USAGE PENALTY (new):
 * Experiences already used this session (by company name, normalized) take a
 * hard -10 score penalty. This ensures the scorer will always prefer an unused
 * experience with equal or lower raw theme-match before repeating one, without
 * completely blocking a repeat when there's genuinely no alternative.
 *
 * Returns at most `limit` experiences — interview answers should lean on
 * ONE strong example, not list everything the candidate has ever done.
 */
export function pickRelevantExperiences(
  profile: ExtractedProfile,
  questionThemes: string[],
  limit = 2,
  usedExperiences: string[] = [],   // ← NEW: company names already cited this session
  usedProofPoints: string[] = [],   // ← NEW: proof-point strings already cited this session
  questionText: string = '',
): ExperienceTag[] {
  if (!profile.experiences.length) return [];

  const themes = questionThemes.map(t => t.toLowerCase());
  const usedCompanies = new Set(usedExperiences.map(c => c.toLowerCase().trim()));
  const usedPoints = new Set(usedProofPoints.map(p => p.toLowerCase().trim()));

  const REPEAT_PENALTY = 10;
  const PROOF_OVERLAP_PENALTY = 2; // per overlapping proof point

  const qLower = questionText.toLowerCase();

  const scored = profile.experiences.map(exp => {
    // Theme match score — same logic as before
    const themeScore = exp.strengths.reduce((acc, s) => {
      const sLower = s.toLowerCase();
      return acc + (themes.some(t => sLower.includes(t) || t.includes(sLower)) ? 1 : 0);
    }, 0);

     const stackHit = exp.stack.some(s => qLower.includes(s.toLowerCase()));
    const stackBonus = stackHit ? 5 : 0;

    // Penalty: this company was already the anchor of a previous answer
    const companyPenalty = usedCompanies.has(exp.company.toLowerCase().trim())
      ? REPEAT_PENALTY
      : 0;

    // Softer penalty: some proof points from this experience were already cited
    const proofOverlap = exp.proofPoints.filter(p =>
      usedPoints.has(p.toLowerCase().trim()),
    ).length;
    const proofPenalty = proofOverlap * PROOF_OVERLAP_PENALTY;

        return { exp, score: themeScore + stackBonus - companyPenalty - proofPenalty, rawThemeScore: themeScore + stackBonus };

  });

  scored.sort((a, b) => b.score - a.score);

  // If nothing scored positively after penalties (all experiences are either
  // already used or don't match the theme), still return the least-repeated
  // experience rather than nothing — a graceful degradation, not a hard block.
  const hasAnyPositive = scored.some(s => s.score > 0);
  const hasAnyThemeMatch = scored.some(s => s.rawThemeScore > 0);

  let ranked = scored;
  if (hasAnyPositive) {
    ranked = scored.filter(s => s.score > 0);
  } else if (hasAnyThemeMatch) {
    // All theme-matching experiences are penalised — still prefer theme matches
    // over non-matches, even penalised ones, so pick from theme-matching pool
    ranked = scored.filter(s => s.rawThemeScore > 0);
  }
  // else: nothing matches at all — fall through with full list sorted by penalty only

  return ranked.slice(0, limit).map(s => s.exp);
}