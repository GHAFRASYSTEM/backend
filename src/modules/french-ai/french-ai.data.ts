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
  label: 'Meeting Someone New',
  scene: `You are meeting someone for the first time in a casual, unplanned social situation anywhere in France — this could be striking up a conversation with someone next to you on the metro in Paris, chatting with a fellow passenger on a regional train, stopping someone at a festival in Toulouse, bonding with a stranger at a beach in Nice, meeting a new flatmate, getting talking with someone at a community sports session, sitting next to someone at a local event or concert, or being introduced to a friend of a friend at a gathering. You initiate or respond to small talk, introduce yourself, ask where they are from or what they do, find common ground, share a laugh, and perhaps exchange contact details or suggest meeting again. The tone is friendly, open, and curious — the goal is simply to connect with someone new.`,
  aiOpener: "Excusez-moi, vous permettez qu'on discute un peu ? Je m'appelle Marc, et vous ?",
  suggestions: [
    "Je m'appelle… et vous, c'est quoi votre prénom ?",
    "Vous êtes d'ici ou vous êtes de passage ?",
    "On pourrait échanger nos numéros, non ?",
  ],
},
{
  label: 'Ordering Food & Drinks',
  scene: `You are at a place where food or drinks are sold — this could be a sit-down restaurant, a street food stall, a bakery, a market vendor, a food truck, a cafeteria, a supermarket deli counter, a juice bar, a patisserie, or a fast-food counter. You walk up or are seated, greet the person serving you, look over what is available (a menu, a chalkboard, items on display, or a glass case), ask questions about what is on offer or what they recommend, place your order — possibly asking to customise it (no sugar, extra sauce, to go), confirm the price, and either pay and leave or sit down and wait for your food. You might also ask about portion sizes, ingredients, whether something is spicy or sweet, or whether they accept card payment.`,
  aiOpener: 'Bonjour ! Qu\'est-ce que je vous sers aujourd\'hui ?',
  suggestions: [
    "Je voudrais un café, s'il vous plaît.",
    "Qu'est-ce que vous recommandez ?",
  ],
},
{
  label: 'Going on a Date',
  scene: `You are spending time with someone you are romantically interested in or already seeing — this could be a first date or an ongoing connection. The setting could be anywhere in France: a wine bar in Lyon, a beach promenade in Nice, a night market in Marseille, a vineyard visit in Bordeaux, a mountain walk in the Alps, a museum in Strasbourg, a boat ride in Annecy, a local festival in Brittany, a picnic by the Seine, or simply wandering a neighbourhood together. The date might involve eating, drinking, watching something, exploring, or just talking. You greet each other, check in on how the other person is doing, make conversation about your surroundings or shared interests, give or receive a compliment, suggest what to do next, share a laugh, express that you are enjoying yourself, and perhaps make plans to meet again. The tone can be warm, playful, a little nervous, or comfortably familiar depending on how well you know each other.`,
  aiOpener: "Salut ! Je suis vraiment content(e) qu'on ait pu se retrouver. C'est sympa ici, non ?",
  suggestions: [
    "Tu as passé une bonne journée ?",
    "Ça fait plaisir de te voir.",
    "C'est la première fois que tu viens ici ?",
  ],
},
{
  label: 'Getting Directions',
  scene: `You are somewhere in France and need to find your way — this could be a busy city street in Paris, a quiet village in Provence, a ski resort in the Alps, a coastal town in Brittany, a sprawling market in Marrakech-influenced Marseille, a wine route in Bordeaux, or a medieval old town in Carcassonne. You might be looking for a train station, a pharmacy, a beach, a car park, a specific street, a tourist landmark, a bus stop, a supermarket, or simply the town centre. You stop someone nearby — a passerby, a shopkeeper, a market vendor, or a local sitting outside — excuse yourself politely, explain what you are looking for, listen to their directions, and confirm you have understood before thanking them and heading off.`,
  aiOpener: "Excusez-moi, je peux vous aider ? Vous avez l'air de chercher quelque chose.",
  suggestions: [
    "Excusez-moi, où se trouve la gare la plus proche ?",
    "C'est loin d'ici ? Je peux y aller à pied ?",
    "Merci beaucoup, vous êtes très gentil(le) !",
  ],
},
{
  label: 'Shopping & Buying Things',
  scene: `You are in a shopping situation somewhere in France — this could be browsing electronics at a Fnac store, picking up groceries at a supermarket, buying clothes at a boutique, haggling at an outdoor market, ordering at a pharmacy, returning a faulty product at a customer service desk, checking out at a DIY store like Leroy Merlin, or picking up a parcel at a relay point. You might be looking for a specific item, asking for help finding something, checking the price, asking about sizes or availability, requesting a refund or exchange, scanning items at a self-checkout, or simply paying and leaving. The person helping you could be a market vendor, a shop assistant, a cashier, a pharmacist, or a customer service agent. You greet them, explain what you need, ask relevant questions, handle the transaction, and wrap up the interaction politely.`,
  aiOpener: "Bonjour ! Je peux vous aider à trouver quelque chose ?",
  suggestions: [
    "Excusez-moi, vous avez ça en d'autres taille ?",
    "Je voudrais retourner cet article, il est défectueux.",
  ],
},
  {
    label:       'Hotel Check-in',
    scene:       'checking in at a French hotel',
    aiOpener:    "Bonsoir! Vous avez une réservation? À quel nom, s'il vous plaît?",
    suggestions: ["J'ai une réservation.", 'Ma chambre est au quel étage?', 'À quelle heure est le petit-déjeuner?'],
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