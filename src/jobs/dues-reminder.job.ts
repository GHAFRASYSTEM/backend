/**
 * Dues reminders: on each of the last 3 days of the month, members who have
 * not paid that month's dues get a push + email. Members who paid in advance
 * already have a payments row for the month, so they are skipped.
 */
import { notify } from '../modules/notifications/notifications.service';
import { settingsService } from '../modules/settings/settings.service';
import { zonedNow, daysInMonth } from './time';

export async function runDuesReminder() {
  const now = zonedNow();
  const daysLeft = daysInMonth(now.year, now.month) - now.day;   // 2, 1, 0 on the last 3 days
  if (daysLeft > 2) return;

  const monthName = new Date(Date.UTC(now.year, now.month - 1, 1))
    .toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

  const title = daysLeft === 0
    ? `Last day to pay ${monthName} dues`
    : `${daysLeft + 1} days left to pay ${monthName} dues`;

  const body = daysLeft === 0
    ? `Today is the last day to pay your GHAFRA dues for ${monthName}. Thank you for keeping the association strong!`
    : `Friendly reminder: your GHAFRA dues for ${monthName} ${now.year} are still unpaid. You can also pay several months in advance in the app.`;

  // Only deep-link to payment when the card/account section is switched on
  const { card_section_enabled } = await settingsService.getAll();

  await notify({
    category: 'dues',
    title,
    body,
    audience: { type: 'unpaid_dues', month: now.month, year: now.year },
    channels: ['push', 'email'],
    data:     card_section_enabled ? { route: '/(account)/paydues', type: 'dues' } : { type: 'dues' },
    source:   'automatic',
    jobKey:   `dues:${now.year}-${now.month}:${now.day}`,
    email:    { subject: `GHAFRA — ${monthName} dues reminder` },
  });
}
