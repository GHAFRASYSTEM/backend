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
// This is intentionally NOT a hardcoded company->category map. The tags are
// derived from the content itself (extracted once via a cheap Groq call and
// cached on the context row), so it stays correct even if the CV changes —
// a new job, a renamed startup, a dropped project all "just work" without a
// code change.

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
 * Returns at most `limit` experiences — interview answers should lean on
 * ONE strong example, not list everything the candidate has ever done.
 */
export function pickRelevantExperiences(
  profile: ExtractedProfile,
  questionThemes: string[],
  limit = 2,
): ExperienceTag[] {
  if (!profile.experiences.length) return [];
  const themes = questionThemes.map(t => t.toLowerCase());

  const scored = profile.experiences.map(exp => {
    const score = exp.strengths.reduce((acc, s) => {
      const sLower = s.toLowerCase();
      return acc + (themes.some(t => sLower.includes(t) || t.includes(sLower)) ? 1 : 0);
    }, 0);
    return { exp, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // If nothing scored (generic/unmatched question), still return the
  // strongest/most senior experience rather than nothing.
  const hasAnyMatch = scored.some(s => s.score > 0);
  const ranked = hasAnyMatch ? scored.filter(s => s.score > 0) : scored;

  return ranked.slice(0, limit).map(s => s.exp);
}