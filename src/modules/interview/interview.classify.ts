import { groq } from '../../shared/groq.client';
import { MODEL_SMALL } from './interview.models';

// ─────────────────────────────────────────────────────────────
// Why this version merges reconstruction + classification
// ─────────────────────────────────────────────────────────────
// Previously this was two separate Groq round-trips on the same input text:
//   1. interview.service.reconstructAndClassify()  → fix STT errors, yes/no gate
//   2. interview.classify.classifyQuestion()        → category, focusHint, etc.
// Both calls read the same text and produce independent, non-overlapping
// fields. There's no reason to pay for two requests (two lots of latency +
// per-request overhead) when one prompt can return both sets of fields as
// a single JSON object.
//
// Speed/cost levers applied here:
//   - Cheap regex fast-paths run first (unchanged in spirit from both old
//     files, merged into one set of checks) — most greetings/farewells/
//     obvious questions never hit Groq at all.
//   - A normalized-question hash cache sits in front of the LLM call, so
//     repeated phrasings (extremely common across interview candidates —
//     "tell me about yourself", "why should we hire you", etc.) are served
//     from memory after the first occurrence, regardless of which user
//     asked first.
//   - The LLM call itself uses a small/cheap model (see MODEL_SMALL below)
//     since this is pure extraction into a fixed schema, not generation —
//     exactly the case where an 8B-class model is fine and a frontier model
//     is wasted spend.
//   - Only ONE Groq call total for reconstruct+classify, vs. two before.
// ─────────────────────────────────────────────────────────────

export type QuestionCategory =
  | 'self_intro'
  | 'behavioral'
  | 'motivation'
  | 'technical'
  | 'project'
  | 'logistics'
  | 'career_transition'
  | 'career_goals'
  | 'hypothetical'
  | 'curveball'
  | 'culture_fit'
  | 'other';

export interface ReconstructClassifyResult {
  /** STT-corrected version of the input text. */
  reconstructed: string;
  /** Whether this is interview content the candidate should respond to. */
  isQuestion: boolean;
  category: QuestionCategory;
  isCompound: boolean;
  focusHint: string;
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
  career_transition: ['leadership', 'autonomie', 'adaptabilité', 'produit', 'travail'],
  career_goals: ['leadership', 'technique', 'autonomie', 'scale', 'produit'],
  other: [],
};

const VALID_CATEGORIES: QuestionCategory[] = [
  'self_intro', 'behavioral', 'motivation', 'technical', 'project',
  'logistics', 'hypothetical', 'career_transition', 'career_goals',
  'curveball', 'culture_fit', 'other',
];

// ─────────────────────────────────────────────────────────────
// Fast path — no Groq call at all for clear-cut cases.
// Mirrors the old fastClassify() + classify.fastPath() logic, merged.
// Returns a full result when confident, or null when the LLM is needed.
// ─────────────────────────────────────────────────────────────

const GREETING_ONLY = ['salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey'];

const HARD_EXCLUDES = [
  'ça va', 'ca va', 'comment tu vas', 'comment vous allez',
  'bonne journée', 'au revoir', 'merci beaucoup', 'à bientôt',
  'ok merci', 'très bien', 'parfait', 'bonsoir tout le monde',
  'can you hear me', 'let me share', 'just a moment',
  "merci d'avoir regardé", "merci d'avoir",
];

const INTERVIEW_OPENERS = [
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

function emptyResult(reconstructed: string, isQuestion: boolean): ReconstructClassifyResult {
  return {
    reconstructed,
    isQuestion,
    category: 'other',
    isCompound: false,
    focusHint: '',
    needsCompanyKnowledgeGap: false,
  };
}

/** Returns a complete result for unambiguous cases, or null if the LLM is needed. */
function fastPath(text: string): ReconstructClassifyResult | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed === '...' || trimmed === '…') {
    return emptyResult(text, false);
  }

  const lower = trimmed.toLowerCase();
  const clean = lower.replace(/[.,!?;:'"()]/g, ' ').trim();

  if (GREETING_ONLY.includes(clean)) return emptyResult(trimmed, false);
  if (HARD_EXCLUDES.some(p => clean === p || clean.startsWith(p + ' '))) {
    return emptyResult(trimmed, false);
  }

  // Unambiguous "definitely a question, definitely self_intro/logistics" cases
  // skip the LLM entirely, including for classification — these phrasings are
  // common enough and rigid enough that misclassification risk is near zero.
  if (/^(parlez[-\s]?moi de vous|présentez[-\s]?vous|tell me about yourself)\W*$/.test(clean)) {
    return { reconstructed: trimmed, isQuestion: true, category: 'self_intro', isCompound: false, focusHint: '', needsCompanyKnowledgeGap: false };
  }
  if (/(rythme d'alternance|votre disponibilité|date de début souhaitée)\W*$/.test(clean)) {
    return { reconstructed: trimmed, isQuestion: true, category: 'logistics', isCompound: false, focusHint: '', needsCompanyKnowledgeGap: false };
  }

  // Confident "this is a question" signal, but category is NOT obvious from
  // regex alone — still needs the LLM call, just skips re-deriving isQuestion.
  // (We don't return early here; this informs the caller via a second pass.)

  return null;
}

/** Lightweight signal only — true/false/null — used to decide whether to trust
 * the LLM's is_question answer or override it client-side. Kept separate from
 * fastPath() because a text can be "obviously a question" while still needing
 * the LLM for category/focusHint. */
function looksLikeQuestion(clean: string): boolean | null {
  if (clean.endsWith('?')) return true;
  if (INTERVIEW_OPENERS.some(o => clean.startsWith(o) || clean.includes(o))) return true;
  return null;
}

// ─────────────────────────────────────────────────────────────
// Normalized-text cache — repeated phrasings across users/turns skip Groq.
// Not per-user: classification of "tell me about a time you failed" doesn't
// depend on who's asking, so the cache is global and keyed by normalized text.
// ─────────────────────────────────────────────────────────────

const RESULT_CACHE = new Map<string, ReconstructClassifyResult>();
const RESULT_CACHE_MAX = 2000; // simple cap to avoid unbounded growth

function normalizeForCache(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()]/g, ' ')
    .replace(/\s+/g, ' ');
}

function cacheGet(key: string): ReconstructClassifyResult | undefined {
  return RESULT_CACHE.get(key);
}

function cacheSet(key: string, value: ReconstructClassifyResult): void {
  if (RESULT_CACHE.size >= RESULT_CACHE_MAX) {
    const firstKey = RESULT_CACHE.keys().next().value;
    if (firstKey !== undefined) RESULT_CACHE.delete(firstKey);
  }
  RESULT_CACHE.set(key, value);
}

// ─────────────────────────────────────────────────────────────
// Main entry point — replaces both the old reconstructAndClassify()
// (in interview.service.ts) and classifyQuestion() (in this file).
// ─────────────────────────────────────────────────────────────

export async function reconstructAndClassify(text: string): Promise<ReconstructClassifyResult> {
  const fast = fastPath(text);
  if (fast) return fast;

  const clean = text.toLowerCase().trim().replace(/[.,!?;:'"()]/g, ' ').trim();
  const questionSignal = looksLikeQuestion(clean);

  const cacheKey = normalizeForCache(text);
  const cached = cacheGet(cacheKey);
  if (cached) {
    // Cache stores the LLM's full read of THIS exact phrasing, including its
    // own reconstruction — safe to reuse verbatim for repeated phrasings.
    return cached;
  }

  try {
    const result = await llmReconstructAndClassify(text);
    // If our regex was confident this is a question, trust that over a
    // model "NO" (mirrors the old isQuestion = looksLikeQuestion || llmSaysYes logic).
    if (questionSignal === true) result.isQuestion = true;
    cacheSet(cacheKey, result);
    return result;
  } catch {
    // Groq failure or bad JSON — never block the response pipeline.
    return emptyResult(text, questionSignal === true);
  }
}

async function llmReconstructAndClassify(text: string): Promise<ReconstructClassifyResult> {
  const res = await groq.chat({
    model: MODEL_SMALL, // mechanical extraction into a fixed schema — small model is sufficient
    messages: [
      {
        role: 'user',
        content: `Tu traites une transcription speech-to-text d'un entretien d'embauche, et tu classifies la question pour router la génération de réponse. Fais les deux tâches en une seule passe.

TÂCHE 1 — Corriger les erreurs de transcription:
Corrige les erreurs phonétiques/STT pour que le texte reflète ce que l'intervieweur voulait probablement dire.
Exemples: "Palma un peu" → "Parlez-moi un peu", "présentay vous" → "présentez-vous"
Garde la langue d'origine (français reste français, anglais reste anglais).

TÂCHE 2 — Déterminer si c'est une question/consigne à laquelle le candidat doit répondre:
OUI pour: questions d'entretien, consignes de parler, questions comportementales, techniques.
NON pour: salutations seules, small talk, admin ("vous m'entendez?"), au revoir.

TÂCHE 3 — Si OUI à la tâche 2, classifie la question (sinon mets "other"):
- self_intro: "parlez-moi de vous", "qui êtes-vous"
- behavioral: demande une histoire vécue passée (conflit, échec, adaptabilité, changement de direction, succès, travail d'équipe, gestion du temps, initiative, résilience) — y compris formulée sans le mot exact
- motivation: "pourquoi vous/nous/ce poste", "où vous voyez-vous dans X ans" (sauf si c'est explicitement une question de carrière à long terme, voir career_goals)
- technical: expliquer un concept, une techno, une différence technique
- project: parler d'un projet/réalisation concrète
- logistics: rythme, disponibilité, dates, contrat
- hypothetical: "que feriez-vous si...", scénario fictif futur (PAS une histoire vécue passée)
- curveball: "pourquoi vous plutôt qu'un autre", "vendez-vous en 30 secondes", question de pression/comparaison
- culture_fit: "quel type d'environnement/équipe vous convient", "avez-vous des questions pour nous"
- career_transition: "pourquoi avez-vous quitté votre dernier poste", "why did you leave your last position", "why are you looking for a new opportunity"
- career_goals: "où vous voyez-vous dans 5 ans", "what are your long term goals", "how does this role fit your future"
- other: ne correspond clairement à aucune catégorie ci-dessus

Réponds UNIQUEMENT en JSON valide, ce format exact, rien d'autre:
{
  "corrected": "texte corrigé",
  "isQuestion": true/false,
  "category": "une_des_catégories_ci_dessus",
  "isCompound": true/false,
  "focusHint": "une phrase en français décrivant ce que la réponse doit absolument prouver pour CETTE question (vide si isQuestion=false)",
  "needsCompanyKnowledgeGap": true/false
}

"isCompound" = true si la question contient clairement 2 demandes distinctes qui doivent toutes les deux être traitées.
"needsCompanyKnowledgeGap" = true si bien répondre nécessiterait des infos précises sur l'entreprise cible qui ne sont probablement pas dans un CV/profil candidat standard.

Input: "${text}"`,
      },
    ],
    temperature: 0.1,
    max_tokens: 300,
  });

  const raw = groq.extractText(res).trim();
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const category: QuestionCategory = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'other';

  return {
    reconstructed: typeof parsed.corrected === 'string' && parsed.corrected.trim() ? parsed.corrected.trim() : text,
    isQuestion: Boolean(parsed.isQuestion),
    category,
    isCompound: Boolean(parsed.isCompound),
    focusHint: typeof parsed.focusHint === 'string' ? parsed.focusHint : '',
    needsCompanyKnowledgeGap: Boolean(parsed.needsCompanyKnowledgeGap),
  };
}

/** Exposed for tests / cache inspection. Not used in production code paths. */
export function _clearClassifyCacheForTests(): void {
  RESULT_CACHE.clear();
}