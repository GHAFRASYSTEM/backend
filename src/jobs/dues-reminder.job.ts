/**
 * Dues reminders to members who haven't paid this month's dues:
 *   - Monday, Wednesday and Friday through the month
 *   - every day during the last 7 days of the month
 * Push every time; email is added in the final week so inboxes aren't flooded.
 * Members who paid in advance already have a payments row for the month, so
 * they're skipped. Sent by the 09:00 tick (daytime only), once per day.
 */
import { notify } from '../modules/notifications/notifications.service';
import { settingsService } from '../modules/settings/settings.service';
import { zonedNow, daysInMonth } from './time';

const REMINDER_WEEKDAYS = new Set([1, 3, 5]);   // Mon, Wed, Fri

export async function runDuesReminder() {
  const now = zonedNow();
  if (now.hour < 9 || now.hour >= 21) return;    // daytime only, from 09:00

  const daysLeft  = daysInMonth(now.year, now.month) - now.day;   // 0 on the last day
  const finalWeek = daysLeft <= 6;
  const weekday   = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay();
  if (!finalWeek && !REMINDER_WEEKDAYS.has(weekday)) return;

  const monthName = new Date(Date.UTC(now.year, now.month - 1, 1))
    .toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

  const title = daysLeft === 0
    ? `Last day to pay ${monthName} dues`
    : finalWeek
    ? `${daysLeft + 1} days left to pay ${monthName} dues`
    : `Reminder: ${monthName} dues`;

  const body = daysLeft === 0
    ? `Today is the last day to pay your GHAFRA dues for ${monthName}. Thank you for keeping the association strong!`
    : finalWeek
    ? `Your GHAFRA dues for ${monthName} ${now.year} are still unpaid — ${daysLeft + 1} days left. You can also pay several months in advance in the app.`
    : `Friendly reminder to pay your GHAFRA dues for ${monthName}. Pay once for several months and these reminders stop.`;

  // Only deep-link to payment when the card/account section is switched on
  const { card_section_enabled } = await settingsService.getAll();

  await notify({
    category: 'dues',
    title,
    body,
    audience: { type: 'unpaid_dues', month: now.month, year: now.year },
    channels: finalWeek ? ['push', 'email'] : ['push'],
    data:     card_section_enabled ? { route: '/(account)/paydues', type: 'dues' } : { type: 'dues' },
    source:   'automatic',
    jobKey:   `dues:${now.year}-${now.month}:${now.day}`,
    email:    { subject: `GHAFRA — ${monthName} dues reminder` },
  });
}
