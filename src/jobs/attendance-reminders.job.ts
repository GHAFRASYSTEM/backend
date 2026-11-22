/**
 * Attendance reminders for today's meetings:
 *   before_start  30 min before starts_at                 → everyone
 *   opened        as soon as check-in is opened (active)  → everyone, push + email
 *   midpoint      halfway through the meeting             → members not signed yet
 *   last_call     10 min before check-in closes           → members not signed yet
 *
 * Meetings without times fall back to activation time: midpoint +60 min,
 * last call +120 min. Each reminder is sent at most once (jobKey), and only
 * within 30 minutes of its slot, so a late restart never sends stale ones.
 */
import { supabase } from '../config/supabase';
import { notify, type NotifyInput } from '../modules/notifications/notifications.service';
import { zonedNow, formatTime } from './time';

const MIN = 60_000;
const GRACE_MS = 30 * MIN;
const ROUTE = '/(tabs)/(community)/attendance';

type Meeting = {
  id: string; title: string; location_name: string | null;
  starts_at: string | null; ends_at: string | null;
  is_active: boolean; activated_at: string | null; updated_at: string;
};

function due(at: number | null, now: number): boolean {
  return at !== null && now >= at && now - at <= GRACE_MS;
}

async function send(meeting: Meeting, kind: string, input: Omit<NotifyInput, 'category' | 'source' | 'jobKey' | 'data'>) {
  await notify({
    ...input,
    category: 'attendance',
    source:   'automatic',
    jobKey:   `meeting:${meeting.id}:${kind}`,
    data:     { route: ROUTE, type: 'attendance', meeting_id: meeting.id },
  });
}

export async function runAttendanceReminders(onlyMeetingId?: string) {
  const zoned = zonedNow();
  const today = zoned.date;
  // Absolute time of 09:00 today in the association's zone (to the minute)
  const nineToday = Date.now() - (zoned.minutesOfDay - 9 * 60) * MIN - (Date.now() % MIN);
  const midnightToday = nineToday - 9 * 60 * MIN;
  let q = supabase
    .from('attendance_meetings')
    .select('id, title, location_name, starts_at, ends_at, is_active, activated_at, updated_at')
    .eq('meeting_date', today)
    .is('cancelled_at', null);
  if (onlyMeetingId) q = q.eq('id', onlyMeetingId);

  const { data, error } = await q;
  if (error) {
    // activated_at missing → migration 011 not applied yet; retry without it
    if (/activated_at/.test(error.message)) {
      console.warn('[attendance-reminders] run migration 011 to enable reminders');
    } else {
      console.error('[attendance-reminders] query failed:', error.message);
    }
    return;
  }

  const now = Date.now();
  for (const m of (data ?? []) as Meeting[]) {
    const start = m.starts_at ? Date.parse(m.starts_at) : null;
    const end   = m.ends_at   ? Date.parse(m.ends_at)   : null;
    const activatedAt = m.activated_at ? Date.parse(m.activated_at) : (m.is_active ? Date.parse(m.updated_at) : null);
    // When check-in effectively opened today: activation, but never before
    // starts_at, and for a meeting activated on an earlier day with no start
    // time, 09:00 on the day — so nobody gets "meeting ongoing" at midnight.
    let opened: number | null = activatedAt;
    if (opened !== null) {
      if (start) opened = Math.max(opened, start);
      else if (opened < midnightToday) opened = nineToday;
    }
    const where  = m.location_name ? ` at ${m.location_name}` : '';

    // Before the meeting
    if (start && due(start - 30 * MIN, now)) {
      await send(m, 'before_start', {
        title:    '⏰ GHAFRA meeting starts in 30 minutes',
        body:     `${m.title} starts at ${formatTime(m.starts_at)}${where}. Check-in opens in the app when the meeting begins.`,
        audience: { type: 'all' },
      });
    }

    if (!m.is_active) continue;

    // Check-in opened — push the moment the job sees it (activation also triggers the job directly)
    if (opened && now >= opened && (!end || now < end)) {
      await send(m, 'opened', {
        title:    'GHAFRA meeting ongoing',
        body:     'GHAFRA meeting ongoing. Kindly sign your attendance in the app now — enter the code announced in the room.',
        audience: { type: 'all' },
        channels: ['push', 'email'],
        email:    { subject: 'GHAFRA meeting ongoing — sign your attendance' },
      });
    }

    // Midpoint
    const mid = start && end ? start + (end - start) / 2 : (opened ? opened + 60 * MIN : null);
    if (due(mid, now)) {
      await send(m, 'midpoint', {
        title:    'Haven’t signed in yet?',
        body:     'The GHAFRA meeting is in full swing and we haven’t got your attendance yet. Open the app and sign in with the room code.',
        audience: { type: 'not_checked_in', meetingId: m.id },
      });
    }

    // Last call
    const last = end ? end - 10 * MIN : (opened ? opened + 120 * MIN : null);
    if (due(last, now)) {
      await send(m, 'last_call', {
        title:    '⌛ Last call to sign attendance',
        body:     'The meeting is wrapping up. Sign your attendance in the app before check-in closes.',
        audience: { type: 'not_checked_in', meetingId: m.id },
      });
    }
  }
}
