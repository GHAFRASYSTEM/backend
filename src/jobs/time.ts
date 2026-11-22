/**
 * Wall-clock helpers in the association's time zone (Europe/Paris by default).
 * Everything the jobs decide — "today", "3 days before month end", "19:00" —
 * is in this zone, whatever zone the server runs in.
 */
import { createHash } from 'crypto';
import { env } from '../config/env';

export const TZ = env.APP_TIMEZONE;

export type ZonedNow = {
  date:   string;   // YYYY-MM-DD
  year:   number;
  month:  number;   // 1-12
  day:    number;
  hour:   number;
  minute: number;
  minutesOfDay: number;
};

export function zonedNow(at: Date = new Date()): ZonedNow {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const year = get('year'), month = get('month'), day = get('day');
  const hour = get('hour'), minute = get('minute');
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    year, month, day, hour, minute, minutesOfDay: hour * 60 + minute,
  };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last Saturday of a month — GHAFRA's standing monthly meeting day. */
export function lastSaturday(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() + 1) % 7));
  return last.toISOString().slice(0, 10);
}

/** Stable pseudo-random integer in [min, max] for a given seed (same seed → same value). */
export function seededInt(seed: string, min: number, max: number): number {
  const n = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return min + (n % (max - min + 1));
}

export function seededPick<T>(seed: string, items: T[]): T {
  return items[seededInt(seed, 0, items.length - 1)];
}

export function formatDayLong(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
