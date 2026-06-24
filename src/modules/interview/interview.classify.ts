import { groq } from '../../shared/groq.client';

// ─────────────────────────────────────────────────────────────
// Why this replaced the regex classifier
// ─────────────────────────────────────────────────────────────
// Keyword regex can only catch phrasings you thought to list. It silently
// fails on: paraphrases ("change direction" vs "adapt"), compound questions
// ("tell me about a challenge AND how it changed you"), hypotheticals
// ("what would you do if..."), curveballs ("why you over other candidates"),
// and culture-fit / "questions for us" — all of which fell into a thin
// 'generic' bucket with almost no structural guidance.
//
// This version asks the model directly what kind of question it is and
// what the answer needs to nail — semantic understanding instead of
// pattern matching. A regex fast-path still handles the cheap, obvious
// cases (so most requests don't need the extra call), and a safe fallback
// guarantees this never throws or blocks the response pipeline.

export type QuestionCategory =
  | 'self_intro'
  | 'behavioral'
  | 'motivation'
  | 'technical'
  | 'project'
  | 'logistics'
  | 'career_transition'
  | 'career_goals'
  | 'hypothetical'   // "What would you do if..." — needs reasoning, not a past-tense story
  | 'curveball'       // "Why you over other candidates?", "Sell yourself in 30 seconds"
  | 'culture_fit'      // "What kind of team do you thrive in?", "Questions for us?"
  | 'other';           // honest fallback — still structured, never blank

export interface QuestionAnalysis {
  category: QuestionCategory;
  /** If true, the question has 2+ distinct parts that both need addressing. */
  isCompound: boolean;
  /** One-line instruction on what this specific answer must nail (from the LLM read of the question). */
  focusHint: string;
  /** True if answering well would require knowledge about the target company the profile doesn't have. */
  needsCompanyKnowledgeGap: boolean;
}

export const CATEGORY_THEMES: Record<QuestionCategory, string[]> = {
  self_intro: ['leadership', 'produit', 'autonomie', 'technique', 'scale'],
  behavioral: ['leadership', 'autonomie', 'travail', 'rigueur', 'communication', 'adaptabilité'],
  motivation: ['leadership', 'produit', 'autonomie'],
  technical: ['technique', 'ia', 'paiement', 'intégration', 'ux'],
  project: ['technique', 'ia', 'paiement', 'scale', 'produit', 'ux'],
  logistics: [],
  hypothetical: ['rigueur', 'communication', 'autonomie'],
  curveball: ['leadership', 'produit', 'scale', 'autonomie'],
  culture_fit: ['travail', 'communication', 'autonomie'],
  career_transition: ['leadership','autonomie','adaptabilité','produit','travail'],
  career_goals: ['leadership','technique','autonomie','scale','produit'],
  other: [],
};

// ─────────────────────────────────────────────────────────────
// Fast path — only for unambiguous, cheap cases. Anything uncertain
// falls through to the LLM call below instead of guessing.
// ─────────────────────────────────────────────────────────────

function fastPath(text: string): QuestionCategory | null {
  const t = text.toLowerCase().trim();

  if (/^(parlez[-\s]?moi de vous|présentez[-\s]?vous|tell me about yourself)\W*$/.test(t)) {
    return 'self_intro';
  }
  if (/(rythme d'alternance|votre disponibilité|date de début souhaitée)\W*$/.test(t)) {
    return 'logistics';
  }
  return null; // anything not crystal-clear goes through the LLM classifier
}

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────

export async function classifyQuestion(text: string): Promise<QuestionAnalysis> {
  const fast = fastPath(text);
  if (fast) {
    return { category: fast, isCompound: false, focusHint: '', needsCompanyKnowledgeGap: false };
  }

  try {
    return await llmClassify(text);
  } catch {
    // Groq failure or bad JSON — never block the answer pipeline.
    return { category: 'other', isCompound: false, focusHint: '', needsCompanyKnowledgeGap: false };
  }
}

async function llmClassify(text: string): Promise<QuestionAnalysis> {
  const res = await groq.chat({
    messages: [
      {
        role: 'user',
        content: `Tu classifies une question d'entretien d'embauche pour router la génération de réponse.

Catégories possibles (choisis-en UNE, la plus dominante):
- self_intro: "parlez-moi de vous", "qui êtes-vous"
- behavioral: demande une histoire vécue passée (conflit, échec, adaptabilité, changement de direction, succès, travail d'équipe, gestion du temps, initiative, résilience) — y compris si formulée sans le mot exact ("comment avez-vous géré...", "racontez une fois où...")
- motivation: "pourquoi vous/nous/ce poste", "où vous voyez-vous dans X ans"
- technical: demande d'expliquer un concept, une techno, une différence technique
- project: demande de parler d'un projet/réalisation concrète
- logistics: rythme, disponibilité, dates, contrat
- hypothetical: "que feriez-vous si...", scénario fictif futur (PAS une histoire vécue passée)
- curveball: "pourquoi vous plutôt qu'un autre", "vendez-vous en 30 secondes", question de pression/comparaison
- culture_fit: "quel type d'environnement/équipe vous convient", "avez-vous des questions pour nous"
- career_transition: "why did you leave your last position",
  "pourquoi avez-vous quitté votre dernier poste",
  "why are you looking for a new opportunity",
  "why did you change jobs"
- career_goals:
  "where do you see yourself in 5 years"
  "what are your long term goals"
  "what are your career aspirations"
  "how does this role fit your future"
  "où vous voyez-vous dans 5 ans"
  "quels sont vos objectifs à long terme"
- other: ne correspond clairement à aucune des catégories ci-dessus

Réponds UNIQUEMENT en JSON valide, ce format exact, rien d'autre:
{
  "category": "une_des_catégories_ci_dessus",
  "isCompound": true/false,
  "focusHint": "une phrase en français décrivant ce que la réponse doit absolument prouver pour CETTE question précise",
  "needsCompanyKnowledgeGap": true/false
}

"isCompound" = true si la question contient clairement 2 demandes distinctes qui doivent toutes les deux être traitées (ex: "racontez un défi ET comment ça a changé votre façon de travailler").
"needsCompanyKnowledgeGap" = true si bien répondre nécessiterait de connaître des infos précises sur l'entreprise cible (culture interne, produits, valeurs) qui ne sont probablement pas dans un CV/profil candidat standard.

Question: "${text}"`,
      },
    ],
    temperature: 0.1,
    max_tokens: 250,
  });

  const raw = groq.extractText(res).trim();
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();
  const parsed = JSON.parse(cleaned);

const validCategories: QuestionCategory[] = [
  'self_intro',
  'behavioral',
  'motivation',
  'technical',
  'project',
  'logistics',
  'hypothetical',
  'career_transition',
  'career_goals',
  'curveball',
  'culture_fit',
  'other',
];
  const category: QuestionCategory = validCategories.includes(parsed.category) ? parsed.category : 'other';

  return {
    category,
    isCompound: Boolean(parsed.isCompound),
    focusHint: typeof parsed.focusHint === 'string' ? parsed.focusHint : '',
    needsCompanyKnowledgeGap: Boolean(parsed.needsCompanyKnowledgeGap),
  };
}