/**
 * french-ai.service.ts
 *
 * Free stack:
 *  - Speech-to-text : Groq Whisper API        (free tier — 7 200 req/day)
 *  - AI brain       : Groq LLaMA 3.3-70b      (free tier — 14 400 req/day)
 *  - Text-to-speech : Kokoro via HF Inference  (free)
 *
 * All Groq calls go through groq.client.ts for key rotation + failure tracking.
 *
 * FEATURES IN THIS FILE
 *  1. Conversational tutor (chat / correction / roleplay / pronunciation modes)
 *  2. Live speech transcription + pronunciation scoring
 *  3. Text-to-speech synthesis
 *  4. AI Writing + Instant Correction
 *  5. Listening & Dictation
 *  6. Reading Comprehension
 *  7. Fill-in-the-Blank / Sentence Builder
 *  8. AI Flashcards (auto-generated from things the learner has actually seen)
 */

import fetch from 'node-fetch';
import { AppError } from '../../shared/errors';
import { groq } from '../../shared/groq.client';
import type {
  ChatRequest,
  TTSRequest,
  TutorConfig,
  RoleplayScene,
  CefrLevel,
  WritingCorrectionRequest,
  WritingCorrectionResult,
  DictationPassageRequest,
  DictationPassage,
  DictationCheckRequest,
  DictationCheckResult,
  ReadingExerciseRequest,
  ReadingExercise,
  ReadingAnswerCheckRequest,
  ReadingAnswerResult,
  FillBlankRequest,
  FillBlankExercise,
  FillBlankCheckRequest,
  FillBlankCheckResult,
  FlashcardSourceItem,
  Flashcard,
} from './french-ai.schema';
import { defaultTTSRequest } from './french-ai.schema';
import { TUTOR_CONFIG } from './french-ai.data';

// ── Env ───────────────────────────────────────────────────────────────────────
const HF_API_TOKEN = process.env.HF_API_TOKEN ?? '';

const KOKORO_MODEL  = 'hexgrad/Kokoro-82M';
const KOKORO_HF_URL = `https://api-inference.huggingface.co/models/${KOKORO_MODEL}`;

// ── Shared CEFR level guide ───────────────────────────────────────────────────
// Used by the chat tutor and every feature below (writing, reading, dictation,
// fill-blank, flashcards) so they all calibrate to the exact same level
// definitions instead of duplicating/drifting copies.
const LEVEL_GUIDE: Record<CefrLevel, string> = {

  A1: `GRAMMAR: Present tense only (être, avoir, -er verbs, a few common irregulars
like aller, faire). No subjunctive, no compound tenses, no relative clauses. Use
short, simple sentence structures — subject + verb + object, max ~8 words each.
Avoid subordinate clauses entirely.

VOCABULARY: High-frequency, concrete, everyday words only — greetings, numbers,
family, food, basic descriptions, daily routine. No idioms, no jargon, no
abstract vocabulary.

TONE: Talk the way you'd talk to someone who landed in France yesterday — warm,
slow, patient, zero jargon. Still react like a real person: "Ah oui !", "Super !",
"Moi aussi !" — these fixed social reactions carry real warmth even at this level
and are exactly the kind of formulaic language A1 learners can recognize and reuse.

WHAT THE LEARNER CAN DO (per CEFR): introduce themselves, ask/answer simple
personal questions (name, age, where they live), use basic greetings and
polite phrases, understand you if you speak slowly and repeat or rephrase.`,

  A2: `GRAMMAR: Present tense as the backbone, with passé composé introduced for
recounting simple past events ("j'ai mangé", "on est allé"). Near future with
"aller + infinitif" is fine. Still no subjunctive, no imperfect for nuance, no
complex relative clauses — "qui" and "que" are okay, nothing fancier.

VOCABULARY: Everyday vocabulary expanding into routine topics — shopping,
directions, work, weather, simple plans, basic opinions ("j'aime", "je préfère").
Introduce one new useful word per reply, dropped in naturally rather than
flagged like a vocab lesson.

TONE: Simple sentences, but let personality show through short reactions and
light personal comments. A2 learners can follow short, clear exchanges about
familiar, predictable topics — keep sentences connected but not layered.

WHAT THE LEARNER CAN DO (per CEFR): describe their background and immediate
environment, handle simple transactional exchanges (shopping, travel, ordering
food), communicate in routine tasks requiring a direct exchange of information.`,

  B1: `GRAMMAR: Natural tense variety — present, passé composé, imparfait
(used correctly for description/background vs. completed action), futur simple,
and conditionnel for polite requests or hypotheticals ("je voudrais", "si j'avais
le temps..."). Relative clauses, basic subordination ("parce que", "quand",
"pendant que") are all fair game. Subjunctive can appear in fixed expressions
("il faut que", "je veux que") without needing to be a focus.

VOCABULARY: Broader everyday range plus some topic-specific vocabulary (travel,
work, current events at a basic level). Comfortable use of everyday idioms and
fixed expressions.

TONE: You can riff a little — add a small personal opinion, a light joke, a
"moi, perso, je trouve que…" — the kind of thing a friend says, not a textbook.
B1 learners can handle most situations likely to arise while travelling, and can
produce connected text on familiar topics.

WHAT THE LEARNER CAN DO (per CEFR): deal with most travel situations, describe
experiences, events, dreams, hopes, and ambitions, give brief reasons and
explanations for opinions and plans, understand the main points of clear
standard speech on familiar matters.`,

  B2: `GRAMMAR: Full range of tenses and moods used naturally, including
subjunctive for opinion/doubt/necessity beyond fixed phrases, plus-que-parfait
for nuanced storytelling, and more complex subordination (concession "bien que",
contrast "alors que", purpose "afin que"). Natural use of pronouns (y, en) and
inversion in questions where appropriate.

VOCABULARY: Wide vocabulary including some abstract and nuanced terms, real
idioms, and register awareness (knowing when to be casual vs. more formal).
Contractions and elisions where a real person would naturally use them.

TONE: Speak like an actual native chatting with a friend — natural rhythm, real
idioms, genuine opinions. Push back gently on what they say sometimes, change
the subject the way conversations actually drift. B2 learners can engage in
extended discussion and defend their views with some fluency and spontaneity.

WHAT THE LEARNER CAN DO (per CEFR): understand the main ideas of complex text
on concrete/abstract topics, interact with a degree of fluency that makes
regular interaction with native speakers possible without strain, produce clear,
detailed text on a wide range of subjects, explain a viewpoint with advantages
and disadvantages.`,

  C1: `GRAMMAR: Full fluency across all tenses, moods, and structures, including
nuanced subjunctive use, complex hypothetical conditionals (si + plus-que-parfait
+ conditionnel passé), and sophisticated discourse connectors (néanmoins,
toutefois, de surcroît, quoi qu'il en soit). Sentence structure should flow with
natural complexity, not just correctness.

VOCABULARY: Idioms, cultural references, register-shifting, wordplay where
appropriate, and precise vocabulary even for abstract or specialized topics.

TONE: Full fluency: nuance, wit, idioms, a real point of view. Debate lightly
if the moment calls for it. Talk *with* them, not *at* them — this is two
adults having a real conversation about something they both find interesting.
C1 learners can express themselves spontaneously and almost effortlessly.

WHAT THE LEARNER CAN DO (per CEFR): understand a wide range of demanding,
longer texts and recognize implicit meaning, express ideas fluently and
spontaneously without much searching for expressions, use language flexibly
and effectively for social, academic, and professional purposes, produce
well-structured, detailed text on complex subjects.`,

  C2: `GRAMMAR: No constraints — full native-level command of every structure,
mood, and register, including literary or formal constructions a native speaker
might use for effect (inversion for emphasis, subjonctif imparfait in very
formal/literary contexts, etc.) Use complexity only where a real native would —
not for its own sake.

VOCABULARY: Precise, idiomatic, and nuanced — including connotation, implication,
irony, and cultural in-jokes. Wordplay and subtlety are fair game.

TONE: Indistinguishable from a sharp, funny native speaker. Treat the student as
a true equal in the conversation — no scaffolding, no simplification, just great
conversation. C2 speakers can handle any topic with total ease, including
distinguishing fine shades of meaning in complex situations.

WHAT THE LEARNER CAN DO (per CEFR): understand virtually everything heard or
read, summarize information from different spoken/written sources reconstructing
arguments coherently, express themselves spontaneously, very fluently and
precisely, differentiating finer shades of meaning even in complex situations.`,
};

// ── Shared Groq JSON helper ───────────────────────────────────────────────────
// Sections 4-8 all want structured (array/object) output rather than the
// linear FRENCH:/ENGLISH:/... format the chat tutor uses. This wraps the
// "ask for strict JSON, strip fences, parse, throw AppError on failure" dance
// so each feature below stays short.
async function callGroqForJSON<T>(
  systemPrompt: string,
  userContent: string,
  opts?: { temperature?: number; max_tokens?: number },
): Promise<T> {
  const data = await groq.chat({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: opts?.temperature ?? 0.7,
    max_tokens: opts?.max_tokens ?? 900,
  });

  const raw = groq.extractText(data);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AppError('Failed to parse AI response as JSON', 502);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. CONVERSATIONAL TUTOR — chat / correction / roleplay / pronunciation
// ══════════════════════════════════════════════════════════════════════════
//
// Design goal: the tutor should feel like a warm, funny, genuinely curious
// French friend — not a quiz machine. Questions are ONE of several moves
// (reacting, riffing, sharing an opinion, teasing gently, suggesting an idea)
// rather than the default ending of every turn. The structured output format
// below stays machine-parseable (the client regex-extracts each labeled
// section), but the *content* inside FRENCH should read like something a
// real person would actually say.
function buildSystemPrompt(
  mode: ChatRequest['mode'],
  level: CefrLevel,
  scene?: string,
): string {
  const base = `You are a warm, funny, genuinely engaged French friend helping someone learn French through real conversation. The student is at CEFR level ${level}.
${LEVEL_GUIDE[level]}

THE GOLDEN RULE: this is a CONVERSATION, not an interview. A real friend doesn't
interrogate you every time you speak. Most of what a person says in conversation
isn't a question — it's a reaction, an opinion, a related story, a bit of teasing,
an exclamation, an "oh that reminds me...". Mix it up. Vary what FRENCH actually does:

  • REACT — "Ah bon ?!", "Sérieux ?", "J'adore !", "Oh non, pas cool ça."
  • SHARE something of your own — a quick opinion, preference, or mini anecdote
    that connects to what they said
  • TEASE or joke gently, when the level and mood allow it
  • SUGGEST an idea or build on theirs ("Tiens, on pourrait aussi...")
  • ASK a question sometimes — genuinely curious, not as a default reflex.
    Maybe 1 in every 2-3 replies has a question, not every single one.
  • Just continue the thought naturally, the way friends let conversation flow
    without needing a question to keep it alive

Read the emotional tone of what they said and match it — excited if they're excited,
sympathetic if they're venting, amused if it's funny. Build on specifics they actually
mentioned instead of generic acknowledgement. If they mention their dog, ask about the
dog (or react to the dog) — don't pivot to an unrelated stock question.

RESPONSE FORMAT — always follow this EXACTLY (each section on its own line):

FRENCH: [Your French reply — warm, natural, human. 1-3 sentences. Pick the
conversational move that actually fits what they just said, per the golden rule above]
ENGLISH: [English translation of your French reply]
CORRECTION: [If the student made a grammar/spelling mistake: "❌ [wrong] → ✅ [correct] — [brief, kind English explanation]". If no mistake, write "none"]
TIP: [A short, practical pronunciation or grammar tip relevant to what was just said — in English. Always include one — make it genuinely useful, not filler]
SUGGESTIONS: [Exactly 3 comma-separated short French phrases the student could say next, matching their level. Make them contextually relevant to this specific conversation turn — never repeat previous suggestions]

Rules:
- Never break the labeled format above
- FRENCH must sound like something an actual person would say out loud to a friend
- Don't default to a question just because that's the "safe" move — variety is the point
- Keep FRENCH concise: 1-3 sentences max, even when you're sharing or reacting`;

  if (mode === 'correction') {
    return `${base}

You're in CORRECTION mode: the student wants real feedback, but you're still their
friend, not a red pen. Gently fix the mistake, explain it kindly and clearly, then
keep the actual conversation going — react to the *content* of what they said, not
just the grammar. The correction is a quick aside, not the whole point of your reply.
In CORRECTION: always provide a correction even for small issues.`;
  }

  if (mode === 'roleplay' && scene) {
    return `${base}

You're fully living this scene as a real character, not narrating it: "${scene}".
Stay in character — have their reactions, their mood, their way of talking. Let the
scene breathe: react to what the student does, improvise naturally, don't railroad
toward some "next step." A real person in this situation wouldn't just ask questions
either — they'd comment, joke, get a little impatient or delighted, depending on who
they are.
In SUGGESTIONS: give phrases specific to this scene that a learner would realistically say next.`;
  }

  if (mode === 'pronunciation') {
    return `${base}

Focus on spoken French — but still talk like a person, not a phonetics manual.
In TIP: give one detailed, concrete pronunciation tip about a sound in your reply
(mouth shape, similar English sound to avoid, common mistake at this level).`;
  }

  return `${base}

Have a real, flowing conversation — the kind where neither person is "running" it.
Follow genuine curiosity and let the topic wander naturally, the way real chats do.`;
}

export async function chatWithTutor(payload: ChatRequest): Promise<{
  reply: string;
  translation: string;
  correction: string | null;
  tip: string | null;
  suggestions: string[];
  rawContent: string;
}> {
  const systemPrompt = buildSystemPrompt(
    payload.mode,
    payload.userLevel,
    payload.roleplayScene,
  );

  const data = await groq.chat({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...payload.messages,
    ],
    temperature: 0.85,
    max_tokens: 600,
  });

  const rawContent = groq.extractText(data);

  const extract = (key: string): string => {
    const match = rawContent.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's'));
    return match?.[1]?.trim() ?? '';
  };

  const reply         = extract('FRENCH');
  const translation   = extract('ENGLISH');
  const rawCorrection = extract('CORRECTION');
  const tip           = extract('TIP') || null;
  const correction    = rawCorrection && rawCorrection.toLowerCase() !== 'none'
    ? rawCorrection
    : null;

  const rawSuggestions = extract('SUGGESTIONS');
  const suggestions = rawSuggestions
    ? rawSuggestions.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
    : [];

  return { reply, translation, correction, tip, suggestions, rawContent };
}

// ══════════════════════════════════════════════════════════════════════════
// 2. TRANSCRIPTION & PRONUNCIATION SCORING
// ══════════════════════════════════════════════════════════════════════════
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  language = 'fr',
): Promise<{ text: string; language: string }> {
  const buildForm = () => {
    const form = new FormData(); // native global FormData (no 'form-data' import in this file)
    const bytes = new Uint8Array(audioBuffer); // sidesteps Buffer/ArrayBufferLike typing mismatch
    const blob = new Blob([bytes], { type: mimeType });
    form.append('file', blob, 'audio.m4a');
    form.append('model', 'whisper-large-v3');
    form.append('language', language);
    form.append('response_format', 'json');
    return form;
  };

  const data = await groq.transcribe(buildForm);
  return { text: data.text ?? '', language: data.language ?? language };
}

export async function scorePronunciation(
  audioBuffer: Buffer,
  mimeType: string,
  expectedText: string,
): Promise<{
  score:      number;
  transcript: string;
  wordScores: { word: string; correct: boolean }[];
  feedback:   string;
}> {
  const { text: transcript } = await transcribeAudio(audioBuffer, mimeType, 'fr');

  const normalise = (s: string) =>
    s.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüÿœæç\s]/g, '').trim();

  const expectedWords = normalise(expectedText).split(/\s+/);
  const spokenWords   = normalise(transcript).split(/\s+/);

  let correct = 0;
  const wordScores = expectedWords.map((word, i) => {
    const match = spokenWords[i] === word;
    if (match) correct++;
    return { word, correct: match };
  });

  const score = Math.round((correct / Math.max(expectedWords.length, 1)) * 100);

  let feedback: string;
  if (score === 100)    feedback = 'Parfait! Your pronunciation is excellent. 🎉';
  else if (score >= 80) feedback = 'Très bien! A few minor differences — keep it up!';
  else if (score >= 60) feedback = 'Pas mal! Focus on the highlighted words and try again.';
  else                  feedback = 'Keep practising! Listen to the model audio first, then record.';

  return { score, transcript, wordScores, feedback };
}

// ══════════════════════════════════════════════════════════════════════════
// 3. TEXT-TO-SPEECH
// ══════════════════════════════════════════════════════════════════════════
export async function synthesizeSpeech(payload: TTSRequest): Promise<Buffer> {
  const kokoro = await tryKokoro(payload.text);
  if (kokoro.length) return kokoro;
  return tryGoogleTTS(payload.text);
}

async function tryKokoro(text: string): Promise<Buffer> {
  if (!HF_API_TOKEN) return Buffer.alloc(0);

  try {
    const res = await fetch(KOKORO_HF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HF_API_TOKEN}`,
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!res.ok) {
      console.warn('Kokoro unavailable, using fallback TTS');
      return Buffer.alloc(0);
    }

    return Buffer.from(await res.arrayBuffer() as ArrayBuffer);
  } catch {
    return Buffer.alloc(0);
  }
}

async function tryGoogleTTS(text: string): Promise<Buffer> {
  const encoded = encodeURIComponent(text.slice(0, 200));
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=fr&client=gtx`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!res.ok) throw new AppError('TTS unavailable', 502);
  return Buffer.from(await res.arrayBuffer());
}

// ══════════════════════════════════════════════════════════════════════════
// 4. AI WRITING + INSTANT CORRECTION
// ══════════════════════════════════════════════════════════════════════════
// The user submits a paragraph/email/message/essay. The AI corrects grammar,
// improves vocabulary, explains mistakes, rewrites it naturally, and gives a
// CEFR-level assessment — all in one exercise.

function buildWritingCorrectionPrompt(level: CefrLevel, context?: string): string {
  return `You are an expert, encouraging French writing tutor. The student (CEFR ${level}) has
submitted a piece of writing${context ? ` (context: ${context})` : ''}.
${LEVEL_GUIDE[level]}

Analyze the text and respond with ONLY a JSON object (no markdown fences, no prose
before or after) matching exactly this shape:

{
  "correctedText": string,           // their text with mistakes fixed, minimal changes
  "mistakes": [
    { "original": string, "correction": string, "explanation": string }
  ],
  "vocabularySuggestions": [
    { "original": string, "suggestion": string, "reason": string }
  ],
  "naturalRewrite": string,          // how a native speaker would express the same ideas
  "cefrAssessment": {
    "estimatedLevel": "A1"|"A2"|"B1"|"B2"|"C1"|"C2",
    "strengths": string[],
    "areasToImprove": string[]
  },
  "overallFeedback": string          // 1-3 warm, specific sentences, in English
}

Rules:
- Be kind and specific. Never just say "good job" — reference the actual content.
- "mistakes" should be empty array if there are none, not omitted.
- estimatedLevel is your honest CEFR read on the writing, which may differ from
  the student's stated level — that's useful signal, don't just repeat it back.
- explanation and reason fields should be short and in English.`;
}

export async function gradeWriting(payload: WritingCorrectionRequest): Promise<WritingCorrectionResult> {
  const systemPrompt = buildWritingCorrectionPrompt(payload.userLevel, payload.context);
  return callGroqForJSON<WritingCorrectionResult>(systemPrompt, payload.text, {
    temperature: 0.4,
    max_tokens: 1200,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 5. LISTENING & DICTATION
// ══════════════════════════════════════════════════════════════════════════
// The AI speaks a sentence/passage; the student types exactly what they hear.
// We then diff it word-by-word, highlight what's missing/wrong, and explain
// the common mistakes — replay is just re-calling synthesizeSpeech again.

function buildDictationPassagePrompt(level: CefrLevel, topic?: string, lengthWords?: number): string {
  const defaultLength = { A1: 8, A2: 12, B1: 20, B2: 30, C1: 40, C2: 50 }[level];
  const target = lengthWords ?? defaultLength;

  return `You write short French listening-dictation passages for language learners.
Student level: CEFR ${level}.
${LEVEL_GUIDE[level]}

Write ONE natural French passage of about ${target} words${topic ? ` about: ${topic}` : ''}.
It should sound like something spoken aloud, not written prose — natural rhythm,
appropriate for the level. Respond with ONLY a JSON object:

{ "text": string }

No markdown fences, no extra keys, no commentary.`;
}

export async function generateDictationPassage(
  payload: DictationPassageRequest,
): Promise<DictationPassage> {
  const systemPrompt = buildDictationPassagePrompt(payload.userLevel, payload.topic, payload.lengthWords);
  const { text } = await callGroqForJSON<{ text: string }>(
    systemPrompt,
    'Generate the passage now.',
    { temperature: 0.8, max_tokens: 300 },
  );

  const audio = await synthesizeSpeech(defaultTTSRequest(text));
  return { text, audioBase64: audio.toString('base64') };
}

// Local word-level diff, same spirit as scorePronunciation — cheap, fast,
// no AI call needed just to compare two strings.
function diffWords(original: string, attempt: string): DictationCheckResult['wordDiff'] {
  const normalise = (s: string) =>
    s.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüÿœæç'\s-]/g, '').trim();

  const origWords = normalise(original).split(/\s+/).filter(Boolean);
  const userWords = normalise(attempt).split(/\s+/).filter(Boolean);

  const diff: DictationCheckResult['wordDiff'] = [];
  const maxLen = Math.max(origWords.length, userWords.length);

  for (let i = 0; i < maxLen; i++) {
    const expected = origWords[i];
    const given = userWords[i];

    if (expected === undefined) {
      diff.push({ word: given ?? '', status: 'extra', userWord: given });
    } else if (given === undefined) {
      diff.push({ word: expected, status: 'missing' });
    } else if (expected === given) {
      diff.push({ word: expected, status: 'correct' });
    } else {
      diff.push({ word: expected, status: 'wrong', userWord: given });
    }
  }

  return diff;
}

function buildDictationExplanationPrompt(level: CefrLevel): string {
  return `You are a French listening tutor reviewing a dictation exercise for a CEFR ${level} student.
You will be given the original passage, the student's attempt, and a word-by-word diff.
Respond with ONLY a JSON object:

{
  "commonMistakeExplanations": string[],  // 1-4 short, kind, specific explanations in English
  "feedback": string                       // 1-2 encouraging sentences, in English
}

Focus on WHY the mistakes likely happened (homophones, liaison, silent letters,
similar-sounding words) rather than just restating what was wrong.`;
}

export async function checkDictation(payload: DictationCheckRequest): Promise<DictationCheckResult> {
  const wordDiff = diffWords(payload.originalText, payload.userAttempt);
  const correctCount = wordDiff.filter(w => w.status === 'correct').length;
  const accuracyScore = Math.round((correctCount / Math.max(wordDiff.length, 1)) * 100);

  const mistakesOnly = wordDiff.filter(w => w.status !== 'correct');

  // Skip the AI call entirely for a perfect or near-empty attempt.
  if (mistakesOnly.length === 0) {
    return {
      accuracyScore,
      wordDiff,
      commonMistakeExplanations: [],
      feedback: 'Parfait! You caught every word. 🎉',
    };
  }

  const systemPrompt = buildDictationExplanationPrompt(payload.userLevel);
  const userContent = JSON.stringify({
    original: payload.originalText,
    attempt: payload.userAttempt,
    diff: mistakesOnly,
  });

  const { commonMistakeExplanations, feedback } = await callGroqForJSON<{
    commonMistakeExplanations: string[];
    feedback: string;
  }>(systemPrompt, userContent, { temperature: 0.5, max_tokens: 400 });

  return { accuracyScore, wordDiff, commonMistakeExplanations, feedback };
}

// ══════════════════════════════════════════════════════════════════════════
// 6. READING COMPREHENSION
// ══════════════════════════════════════════════════════════════════════════
// Generate a level-appropriate passage plus MCQ / short-answer / vocab-in-
// context / summary questions, then grade free-text answers afterward.

function buildReadingExercisePrompt(level: CefrLevel, topic?: string): string {
  return `You create French reading-comprehension exercises for language learners.
Student level: CEFR ${level}.
${LEVEL_GUIDE[level]}

Write a passage appropriate for this level${topic ? ` about: ${topic}` : ' on a topic a learner would find engaging'},
then create a mix of questions. Respond with ONLY a JSON object matching exactly:

{
  "passage": string,
  "vocabHighlights": [ { "word": string, "meaning": string } ],   // 3-6 useful words from the passage
  "questions": [
    {
      "id": string,                 // short unique id like "q1"
      "type": "multiple_choice" | "short_answer" | "vocab_in_context" | "summary",
      "question": string,
      "options": string[],          // ONLY for multiple_choice, exactly 4 options
      "correctAnswer": string       // for multiple_choice (must exactly match one option) and vocab_in_context
    }
  ]
}

Include at least: 2 multiple_choice, 1 vocab_in_context, 1 short_answer, and end
with 1 summary question ("Résumez ce texte en une ou deux phrases."). No markdown
fences, no commentary outside the JSON.`;
}

export async function generateReadingExercise(payload: ReadingExerciseRequest): Promise<ReadingExercise> {
  const systemPrompt = buildReadingExercisePrompt(payload.userLevel, payload.topic);
  return callGroqForJSON<ReadingExercise>(systemPrompt, 'Generate the exercise now.', {
    temperature: 0.75,
    max_tokens: 1200,
  });
}

function buildReadingGradingPrompt(level: CefrLevel): string {
  return `You are grading a French reading-comprehension exercise for a CEFR ${level} student.
You'll receive the passage, the questions (with correct answers where applicable), and
the student's answers. Grade short_answer and summary questions on meaning/content, not
exact wording — be generous with grammar slips, this isn't a writing test.

Respond with ONLY a JSON object:

{
  "results": [
    { "questionId": string, "correct": boolean, "feedback": string, "modelAnswer": string }
  ],
  "overallScore": number,       // 0-100
  "overallFeedback": string     // 1-2 encouraging sentences, in English
}

feedback per question should be short, specific, and in English. Include modelAnswer
only for short_answer/summary questions where it's useful context.`;
}

export async function gradeReadingAnswers(payload: ReadingAnswerCheckRequest): Promise<ReadingAnswerResult> {
  const systemPrompt = buildReadingGradingPrompt(payload.userLevel);
  const userContent = JSON.stringify({
    passage: payload.exercise.passage,
    questions: payload.exercise.questions,
    userAnswers: payload.userAnswers,
  });

  return callGroqForJSON<ReadingAnswerResult>(systemPrompt, userContent, {
    temperature: 0.3,
    max_tokens: 900,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 7. FILL-IN-THE-BLANK / SENTENCE BUILDER
// ══════════════════════════════════════════════════════════════════════════
// Quick, dynamically-generated grammar drills: missing word, scrambled
// sentence, verb tense choice, or idiomatic expression completion.

function buildFillBlankPrompt(level: CefrLevel, focus: FillBlankRequest['focus'], count: number): string {
  return `You create short, dynamic French grammar drills for language learners.
Student level: CEFR ${level}. Focus: ${focus}.
${LEVEL_GUIDE[level]}

Generate exactly ${count} exercises appropriate for this level. Mix these types as
fits the requested focus (if focus is "mixed", vary across all four):
- fill_blank: a sentence with one word replaced by "___", options is a 4-word bank if helpful
- scrambled: prompt is the words in scrambled order joined by " / ", correctAnswer is the properly ordered sentence
- verb_tense: a sentence with "___" where a verb goes, options gives 3-4 conjugated choices
- idiom: a sentence with "___" completing a common French idiomatic expression

Respond with ONLY a JSON object:

{
  "exercises": [
    {
      "id": string,
      "type": "fill_blank" | "scrambled" | "verb_tense" | "idiom",
      "prompt": string,
      "options": string[],
      "correctAnswer": string,
      "explanation": string   // short, in English, explains the grammar/vocab point
    }
  ]
}

No markdown fences, no commentary outside the JSON.`;
}

export async function generateFillBlankSet(payload: FillBlankRequest): Promise<FillBlankExercise[]> {
  const systemPrompt = buildFillBlankPrompt(payload.userLevel, payload.focus, payload.count);

  const { exercises } = await callGroqForJSON<{ exercises: FillBlankExercise[] }>(
    systemPrompt,
    'Generate the exercises now.',
    { temperature: 0.75, max_tokens: 1000 },
  );

  return exercises;
}

// Purely local — no AI call needed to compare an answer we already generated
// alongside its explanation.
export function checkFillBlankAnswer(payload: FillBlankCheckRequest): FillBlankCheckResult {
  const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const correct = normalise(payload.userAnswer) === normalise(payload.exercise.correctAnswer);

  return {
    correct,
    correctAnswer: payload.exercise.correctAnswer,
    explanation: payload.exercise.explanation,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 8. AI FLASHCARDS (auto-generated from real learner content)
// ══════════════════════════════════════════════════════════════════════════
// Instead of a static deck, mine vocabulary out of conversations, roleplays,
// reading passages, or video transcripts the learner has actually engaged
// with — so review is always tied to something they've really encountered.

function buildFlashcardPrompt(level: CefrLevel, count: number): string {
  return `You create vocabulary flashcards for a French learner at CEFR ${level} from
real content they've just encountered (conversations, roleplays, reading passages,
or video transcripts, each tagged with its source type).
${LEVEL_GUIDE[level]}

Pick the ${count} most useful words or short phrases across all the provided content
— prioritize things that are genuinely reusable at this level, not rare one-offs.
For each, respond with ONLY a JSON object:

{
  "flashcards": [
    {
      "word": string,
      "meaning": string,                     // English meaning
      "pronunciation": string,                // simple phonetic guide, e.g. "boh-koo"
      "exampleSentence": string,              // NEW example sentence, not copied from the source
      "exampleSentenceTranslation": string,
      "followUpQuestion": string,             // a question IN FRENCH using the word, to prompt active recall
      "sourceType": "conversation" | "roleplay" | "reading" | "video"
    }
  ]
}

No markdown fences, no commentary outside the JSON. Don't repeat the same word twice.`;
}

export async function generateFlashcardsFromContent(
  items: FlashcardSourceItem[],
  userLevel: CefrLevel,
  count = 8,
): Promise<Flashcard[]> {
  const systemPrompt = buildFlashcardPrompt(userLevel, count);
  const userContent = JSON.stringify(
    items.map(i => ({ sourceType: i.sourceType, text: i.text.slice(0, 4000) })),
  );

  const { flashcards } = await callGroqForJSON<{ flashcards: Flashcard[] }>(
    systemPrompt,
    userContent,
    { temperature: 0.6, max_tokens: 1400 },
  );

  return flashcards;
}

/** Synthesizes audio for a single flashcard word — call lazily (e.g. on first flip), not for a whole deck at once, to stay within TTS rate limits. */
export async function synthesizeFlashcardAudio(word: string): Promise<Buffer> {
  return synthesizeSpeech(defaultTTSRequest(word));
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════
export function getTutorConfig(): TutorConfig {
  return TUTOR_CONFIG;
}

export type { TutorConfig, RoleplayScene };