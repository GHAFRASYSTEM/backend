/**
 * Daily French practice nudge at 19:00 for members who haven't used any
 * French tutor feature today.
 */
import { notify } from '../modules/notifications/notifications.service';
import { zonedNow, seededPick } from './time';

const MESSAGES = [
  { title: 'Bonsoir ! Ta pratique du jour ?', body: 'Just 5 minutes of French before the day ends — chat with your AI tutor or try a quick quiz.' },
  { title: 'On parle un peu ?', body: 'Your French tutor is waiting. One short voice conversation keeps your streak alive!' },
  { title: 'Petit rappel', body: "You haven't practised French today. A quick flashcard round counts — allez !" },
  { title: 'Un mot par jour…', body: '…keeps the accent at bay. Practise your French once before midnight.' },
  { title: 'Daily French goal', body: 'Tap to practise for a few minutes. Small daily steps make big progress.' },
  { title: 'Garde ta série !', body: "Don't break your practice streak — one exercise is all it takes today." },
];

export async function runFrenchPracticeReminder() {
  const now = zonedNow();
  if (now.hour < 18 || now.hour >= 22) return;   // evening nudge (sent by the 19:00 tick)
  const msg = seededPick(`practice:${now.date}`, MESSAGES);
  await notify({
    category: 'french_practice',
    ...msg,
    audience: { type: 'not_practiced_today', day: now.date },
    data:     { route: '/(tabs)/(learn)', type: 'french_practice' },
    source:   'automatic',
    jobKey:   `practice:${now.date}`,
  });
}
