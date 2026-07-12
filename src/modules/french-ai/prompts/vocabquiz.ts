// src/french-ai/prompts/vocabquiz.ts

import type { CefrLevel } from '../french-ai.schema';
import type { VocabCategory, VocabQuizRequest } from '../french-ai.schema';
import { LEVEL_GUIDE } from '../french-ai.prompts';

// ══════════════════════════════════════════════════════════════════════════
// 9. VOCAB QUIZ
// ══════════════════════════════════════════════════════════════════════════
const CATEGORY_GUIDE: Record<VocabCategory, string> = {
numbers: `
Numbers, from the tricky ranges up through big numbers, plus every real-world
context a number shows up in. Rotate across ALL of these sub-areas rather
than clustering on easy round numbers:

- The irregular 60-99 zone specifically: soixante (60) through
  soixante-dix-neuf (79), quatre-vingts (80) through
  quatre-vingt-dix-neuf (99). This is the #1 confusion zone for English
  speakers (70 = "sixty-ten", 80 = "four-twenties", 90 = "four-twenty-ten")
  — deliberately include several questions drilling exactly this range,
  covering a real spread of values across it, not just 70/80/90 themselves.
- Hundreds and thousands: cent, deux cents, cent un (no "s" once followed by
  another number), mille, deux mille, and mixed forms like "mille neuf cent
  quatre-vingt-six" (1986).
- Dates: full dates spoken aloud ("le quinze mars deux mille vingt-quatre"),
  years, days of the week + numbers ("le 3 avril").
- Time: build fluency gradually across quarter past / half past / quarter to,
  noon and midnight, the 24-hour clock used for transport schedules and
  business hours, formal vs. informal time expressions ("il est quinze
  heures" vs. "il est trois heures de l'après-midi"), durations ("pendant
  deux heures"), and everyday time vocabulary (tôt, tard, en avance, en
  retard, à l'heure).
- Weights and measures: kilos, grammes, litres, mètres, in everyday sentences
  a shopper or traveler would actually say ("Je voudrais un kilo et demi de
  pommes").

Because the numbers themselves can be genuinely hard to parse by ear, every
option's "text" must be the French numeral/expression spelled out AND paired
with an "englishHint" giving a short plain-English gloss of the value in
parentheses — a numeral for cardinal numbers (e.g. "(92)"), a clock time for
time expressions (e.g. "(3:15pm)"), and a plain date for dates (e.g. "(April
3rd)"). This lets the learner confirm what they selected even if their
listening comprehension lags their recognition.

TIME AND QUANTITY ARE HIGH-RISK FOR AMBIGUITY: a bare blank like "Il est ___
heures" or "Je voudrais ___ kilos de pommes" has no unique answer from text
alone — any plausible number reads as grammatically fine. Follow the
AMBIGUITY RULE below for every question in this category: either build a
real disambiguator into the sentence text, or lean on audio as the sole
source of truth and write wrongExplanation truthfully (what was said vs.
what this option says), never inventing a textual justification the
sentence doesn't actually contain.`,

  quantifiers: `
Indefinite quantity adjectives and expressions: quelque(s), plusieurs,
chaque, certain(e)s, aucun(e), tout/toute/tous/toutes, la plupart de,
beaucoup de, peu de, assez de, trop de, quelques-un(e)s. Test both meaning
and agreement (gender/number, and whether the word takes "de + noun" or
agrees directly with the noun). For each option's englishHint, give a short
gloss of the quantity meaning, e.g. text: "plusieurs", englishHint:
"several / more than one".`,

  electrical_appliances: `Household electrical appliances and electronics: le
frigo, le grille-pain, la machine à laver, l'aspirateur, le four à
micro-ondes, le sèche-linge, le fer à repasser, and similar everyday items.`,

  verbs: `High-frequency everyday verbs appropriate for the level, mostly in
infinitive form, occasionally shown conjugated in a natural sentence context.`,

  adjectives: `Common descriptive adjectives — physical appearance, emotion,
and opinion/quality adjectives a learner would actually reach for.`,

  food: `Everyday food and drink vocabulary — fruits, vegetables, meals,
drinks, basic cooking terms.`,

  family: `Family member vocabulary and relationship terms.`,

  travel: `Travel and transportation vocabulary — bus, train, airport,
luggage, tickets, directions.`,

  colors: `Color vocabulary, including a few shades and common color-related
expressions ("voir la vie en rose").`,

  custom: `A general, useful mix of everyday vocabulary appropriate for the level.`,
};

export function buildVocabQuizPrompt(
  level: CefrLevel,
  focus: { category?: VocabCategory; words?: string[] },
  questionTypes: VocabQuizRequest['questionTypes'],
  count: number,
): string {
  const topicDescription = focus.category
    ? CATEGORY_GUIDE[focus.category]
    : `Base every question on ONLY this specific set of words/phrases (don't
introduce unrelated vocabulary): ${focus.words!.join(', ')}`;

  return `You create French vocabulary quiz questions for a CEFR ${level} learner.
${LEVEL_GUIDE[level]}

TOPIC: ${topicDescription}

Generate exactly ${count} questions, using only these question types: ${questionTypes.join(', ')}
(mix across them if more than one is listed). Vary sentence subjects/settings
and vary WHICH sub-area of the topic each question hits — don't cluster on
the easiest cases.

- listening_choice: "prompt" is a single French word or short phrase that will
  be spoken aloud. Provide exactly 4 "options": one correct (matches the
  prompt exactly) and 3 plausible distractors — words a learner could
  genuinely mishear the prompt as (similar sound, similar rhythm, a classic
  confusion for this topic — e.g. soixante vs soixante-dix). For each WRONG
  option, write a short, kind "wrongExplanation" in English clarifying how it
  differs from what was actually said. Do not add wrongExplanation to the
  correct option.

- sentence_completion: "prompt" is a natural French sentence with exactly one
  blank written as "___". Provide exactly 4 "options" (single words or short
  phrases): one correct fit and 3 that are wrong because of meaning, gender/
  number agreement, or register. For each WRONG option, write a short,
  specific "wrongExplanation" in English (e.g. "means happy, not tired" or
  "wrong gender — this needs the feminine form").

  - AMBIGUITY RULE for sentence_completion, especially numbers, dates, times,
  and quantities: before finalizing a question, check whether MORE THAN ONE
  of your 4 options would sound equally correct to a native speaker reading
  the sentence with no audio. If so, the question is broken — fix it one of
  two ways:
    (a) Add a genuine disambiguating detail INTO THE SENTENCE TEXT ITSELF
        (a total that implies the quantity via arithmetic, an explicit
        comparison, a second clause that pins the number down), OR
    (b) If no natural disambiguator exists, accept that the audio is the
        sole source of truth for this question — the sentence will be
        spoken aloud WITH THE CORRECT ANSWER FILLED IN (not blanked), so the
        learner determines the right option by listening, not by grammar
        alone. In this case, keep the sentence natural but do NOT invent a
        wrongExplanation that pretends the text disambiguates something it
        doesn't. Explanations must be truthful: for numbers/quantities in
        this situation, phrase wrongExplanation as what the learner heard
        vs. what this option says (e.g. "You heard deux, not sept — sept
        would sound completely different"), never as a fabricated textual
        justification like "the sentence implies 2" when it doesn't.
  A bare blank like "J'ai ___ kilos de pommes" with no arithmetic, no
  comparison, and 4 grammatically-fine numbers as options is NOT an
  acceptable question — either add a clue or rely truthfully on audio per
  (b) above.

  - sentence_completion: "prompt" is a natural French sentence with exactly one
  blank written as "___". Provide exactly 4 "options" (single words or short
  phrases): one correct fit and 3 that are wrong because of meaning, gender/
  number agreement, or register — or, for numbers/quantities disambiguated by
  audio per the AMBIGUITY RULE below, wrong because they're simply not what
  was said. For each WRONG option, write a short, specific "wrongExplanation"
  in English that is TRUE given what's actually in the sentence and/or audio
  — never invent a contextual justification the sentence doesn't contain.

For EVERY option, also include "englishHint": a short English gloss of that
option (a translation, or for numbers the numeral in parentheses, e.g.
"(80)"). This is mandatory for the "numbers" and "quantifiers" topics, and
should be included for every other topic too so the learner always knows
what they're choosing between.

For EVERY question, include "sayItOutLoud": one natural, complete French
sentence that uses the correct answer in context, written for the learner to
read aloud as pronunciation/production practice. This should be different
from "prompt" for sentence_completion questions (don't just repeat the blank
sentence filled in — write a fresh sentence).

CRITICAL — option ordering: do NOT place the correct option at the same
index in every question. Randomize which of the 4 slots (0-3) holds
"correct": true so that, across the ${count} questions, the correct answer
lands roughly evenly across all four positions. A predictable "always first"
pattern defeats the purpose of a multiple-choice quiz.

Respond with ONLY a JSON object matching exactly:

{
  "questions": [
    {
      "id": string,
      "type": "listening_choice" | "sentence_completion",
      "prompt": string,
      "sayItOutLoud": string,
      "options": [
        { "id": string, "text": string, "correct": boolean, "wrongExplanation": string, "englishHint": string }
      ]
    }
  ]
}

Exactly 4 options per question, exactly 1 marked correct: true. No markdown
fences, no commentary outside the JSON.`;


}