/**
 * Meeting countdown.
 *  - Each of the 7 days before a GHAFRA meeting: one push at a random time
 *    between 09:00 and 20:00 (stable per day, so restarts don't move it).
 *  - On the day: a special "Today is GHAFRA meeting" push + email at 08:00.
 *
 * The meeting comes from attendance_meetings when an admin has scheduled one;
 * otherwise the standing rule (last Saturday of the month) is used.
 */
import { supabase } from '../config/supabase';
import { notify } from '../modules/notifications/notifications.service';
import {
  zonedNow, daysBetween, lastSaturday, seededInt, seededPick, formatDayLong, formatTime,
} from './time';

const WINDOW_START = 9 * 60;    // 09:00
const WINDOW_END   = 19 * 60;   // 19:00 — latest random slot (last external tick runs at 19:00)
const SEND_UNTIL   = 21 * 60;   // don't send a missed slot after 21:00
const MEETING_DAY_AT = 8 * 60;  // 08:00

const COUNTDOWN_MESSAGES: Array<(d: number, day: string) => { title: string; body: string }> = [
  (d, day) => ({ title: `⏳ ${d} days to GHAFRA meeting`, body: `See you on ${day}! Mark your calendar and bring a friend.` }),
  (d, day) => ({ title: `GHAFRA meets in ${d} days`, body: `Our monthly meeting is on ${day}. Your voice matters — plan to be there.` }),
  (d, day) => ({ title: `Save the date: ${day}`, body: `Only ${d} days until we gather again. Akwaaba to everyone!` }),
  (d, day) => ({ title: `${d} days to go!`, body: `The GHAFRA family meets on ${day}. Catch up, share ideas, and sign your attendance in the app.` }),
  (d, day) => ({ title: `Countdown: ${d} days`, body: `Have you planned for ${day}? The GHAFRA meeting is coming up.` }),
];

const TOMORROW_MESSAGES: Array<(day: string) => { title: string; body: string }> = [
  () => ({ title: 'GHAFRA meeting is tomorrow!', body: 'Get ready — we meet tomorrow. Remember to sign your attendance in the app when you arrive.' }),
  () => ({ title: 'Tomorrow: GHAFRA meeting', body: 'One more sleep! Bring your ideas, and your phone to check in.' }),
];

type NextMeeting = { date: string; title: string; location: string | null; startsAt: string | null };

async function findNextMeeting(today: string): Promise<NextMeeting | null> {
  const { data } = await supabase
    .from('attendance_meetings')
    .select('meeting_date, title, location_name, starts_at')
    .is('cancelled_at', null)
    .gte('meeting_date', today)
    .order('meeting_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  // A scheduled meeting within the next ~5 weeks overrides the standing rule
  if (data && daysBetween(today, data.meeting_date) <= 35) {
    return { date: data.meeting_date, title: data.title, location: data.location_name, startsAt: data.starts_at };
  }

  const now = zonedNow();
  let rule = lastSaturday(now.year, now.month);
  if (rule < today) {
    const nextMonth = now.month === 12 ? 1 : now.month + 1;
    rule = lastSaturday(now.month === 12 ? now.year + 1 : now.year, nextMonth);
  }
  return { date: rule, title: 'GHAFRA Monthly Meeting', location: null, startsAt: null };
}

export async function runMeetingCountdown() {
  const now = zonedNow();
  const meeting = await findNextMeeting(now.date);
  if (!meeting) return;

  const daysLeft = daysBetween(now.date, meeting.date);
  const dayLabel = formatDayLong(meeting.date);
  const data = { route: '/(tabs)/(community)/eventCalendar', type: 'meeting_countdown' };

  // ── Meeting day ──────────────────────────────────────────────────────────
  if (daysLeft === 0) {
    if (now.minutesOfDay < MEETING_DAY_AT || now.minutesOfDay > SEND_UNTIL) return;
    const time  = formatTime(meeting.startsAt);
    const where = meeting.location ? ` at ${meeting.location}` : '';
    const body  = `Today is GHAFRA meeting day${time ? `, starting ${time}` : ''}${where}. We can't wait to see you — don't forget to sign your attendance in the app!`;
    await notify({
      category: 'meetings',
      title:    'Today is GHAFRA Meeting!',
      body,
      audience: { type: 'all' },
      channels: ['push', 'email'],
      data,
      source:   'automatic',
      jobKey:   `meeting-day:${meeting.date}`,
      email:    { subject: `Today is GHAFRA Meeting — ${dayLabel}` },
    });
    return;
  }

  // ── 7-day countdown ──────────────────────────────────────────────────────
  if (daysLeft < 1 || daysLeft > 7) return;

  const slot = seededInt(`countdown:${meeting.date}:${now.date}`, WINDOW_START, WINDOW_END);
  if (now.minutesOfDay < slot || now.minutesOfDay > SEND_UNTIL) return;

  const msg = daysLeft === 1
    ? seededPick(`msg:${now.date}`, TOMORROW_MESSAGES)(dayLabel)
    : seededPick(`msg:${now.date}`, COUNTDOWN_MESSAGES)(daysLeft, dayLabel);

  await notify({
    category: 'meetings',
    ...msg,
    audience: { type: 'all' },
    data,
    source:   'automatic',
    jobKey:   `countdown:${meeting.date}:${now.date}`,
  });
}
