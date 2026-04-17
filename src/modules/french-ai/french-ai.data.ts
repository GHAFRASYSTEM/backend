/**
 * french-ai.data.ts
 *
 * All static content for the French AI tutor.
 * Pronunciation phrases are now loaded dynamically from readme_fr.jsonl.
 */

import type { TutorConfig } from './french-ai.schema';
import { getRandomPronunciationPhrases } from './data/cefr/cefr-loader';

// ── Roleplay scenes ────────────────────────────────────────────────────────────
export const ROLEPLAY_SCENES = [
  {
    label:       'Paris Café',
    scene:       'ordering food at a Paris café',
    aiOpener:    'Bonjour! Bienvenue au Café de Flore. Vous avez une réservation?',
    suggestions: ["Un café, s'il vous plaît.", "Qu'est-ce que vous recommandez?", "L'addition, s'il vous plaît."],
  },
{
  label: 'Going on a Date',
  scene: 'meeting someone you have been seeing for a while at a café or park in Paris. You already know each other and are continuing to build your connection in a relaxed, familiar atmosphere',
  aiOpener: "Salut ! Tu es arrivé(e) vite. Ça me fait plaisir de te revoir.",
  suggestions: [
    "Tu as passé une bonne journée ?",
    "Ça fait du bien de te voir encore.",
    "On prend comme d’habitude ?",
    "Alors, quoi de neuf depuis la dernière fois ?",
  ],
},
  {
    label:       'Getting Directions',
    scene:       'asking for directions in Lyon',
    aiOpener:    'Excusez-moi? Vous cherchez quelque chose?',
    suggestions: ['Où est la gare?', "C'est loin d'ici?", 'Merci beaucoup!'],
  },
  {
    label:       'Market Shopping',
    scene:       'shopping at a French market',
    aiOpener:    "Bonjour! Regardez ces beaux légumes! Qu'est-ce qu'il vous faut aujourd'hui?",
    suggestions: ['Combien coûte ça?', 'Je voudrais un kilo de tomates.', "C'est trop cher."],
  },
  {
    label:       'Hotel Check-in',
    scene:       'checking in at a French hotel',
    aiOpener:    "Bonsoir! Vous avez une réservation? À quel nom, s'il vous plaît?",
    suggestions: ["J'ai une réservation.", 'Ma chambre est au quel étage?', 'À quelle heure est le petit-déjeuner?'],
  },
  {
    label:       'Meeting a Neighbour',
    scene:       'chatting with a French neighbour',
    aiOpener:    "Oh, bonjour! Vous êtes le nouveau voisin? Je m'appelle Isabelle.",
    suggestions: ["Je m'appelle...", "J'habite ici depuis...", 'Vous habitez ici depuis longtemps?'],
  },
  {
    label:       'Doctor Visit',
    scene:       'visiting a doctor in France',
    aiOpener:    "Bonjour, entrez! Qu'est-ce qui vous amène aujourd'hui?",
    suggestions: ["J'ai mal à la tête.", "Depuis deux jours.", "Vous pouvez me prescrire quelque chose?"],
  },
  {
    label:       'Job Interview',
    scene:       'a job interview at a French company',
    aiOpener:    "Bonjour, asseyez-vous! Parlez-moi un peu de vous.",
    suggestions: ["J'ai cinq ans d'expérience.", "Je suis très motivé.", "Quelles sont les perspectives d'évolution?"],
  },
];

// ── Levels with dynamically loaded pronunciation phrases ───────────────────────
export const TUTOR_LEVELS = [
  { key: 'A1', label: 'Beginner' },
  { key: 'A2', label: 'Elementary' },
  { key: 'B1', label: 'Intermediate' },
  { key: 'B2', label: 'Upper-Intermediate' },
  { key: 'C1', label: 'Advanced' },
  { key: 'C2', label: 'Proficiency' },
];

// ── Assembled config ───────────────────────────────────────────────────────────
export const TUTOR_CONFIG: TutorConfig = {
  levels:         TUTOR_LEVELS,
  roleplayScenes: ROLEPLAY_SCENES,
};

/**
 * Load pronunciation phrases into the levels (called once at startup)
 */
export async function initializePronunciationPhrases(): Promise<void> {
  console.log('Loading pronunciation phrases from readme_fr.jsonl...');

  for (const level of TUTOR_LEVELS) {
    const phrases = await getRandomPronunciationPhrases(level.key, 50); // Load up to 50 per level
    // Attach phrases directly to the level object
    (level as any).pronunciationPhrases = phrases;
  }

  console.log('✅ Pronunciation phrases loaded for all levels');
}