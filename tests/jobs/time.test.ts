import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/firebase', () => ({ fcm: { sendEachForMulticast: vi.fn() } }));

import {
  lastSaturday, daysBetween, addDays, daysInMonth, seededInt, seededPick, zonedNow,
} from '../../src/jobs/time';
import { isExpoToken } from '../../src/modules/notifications/push.transport';

describe('jobs/time', () => {
  it('finds the last Saturday of a month', () => {
    expect(lastSaturday(2026, 11)).toBe('2026-11-28');
    expect(lastSaturday(2026, 2)).toBe('2026-02-28');   // month ends on a Saturday
    expect(lastSaturday(2027, 1)).toBe('2027-01-30');
    expect(lastSaturday(2026, 5)).toBe('2026-05-30');
  });

  it('counts days between dates across months and DST', () => {
    expect(daysBetween('2026-11-21', '2026-11-28')).toBe(7);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);   // spring DST weekend
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows month lengths, including leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 11)).toBe(30);
  });

  it('gives a stable random slot per seed, inside the range', () => {
    const a = seededInt('countdown:2026-11-28:2026-11-22', 540, 1200);
    expect(seededInt('countdown:2026-11-28:2026-11-22', 540, 1200)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(540);
    expect(a).toBeLessThanOrEqual(1200);
    const slots = new Set(Array.from({ length: 7 }, (_, i) => seededInt(`countdown:x:${i}`, 540, 1200)));
    expect(slots.size).toBeGreaterThan(3);   // varies day to day
    expect(['a', 'b', 'c']).toContain(seededPick('seed', ['a', 'b', 'c']));
  });

  it('reads wall-clock time in Europe/Paris', () => {
    // 2026-11-22T22:30Z is 23:30 in Paris (UTC+1 in winter)
    const z = zonedNow(new Date('2026-11-22T22:30:00Z'));
    expect(z).toMatchObject({ date: '2026-11-22', hour: 23, minute: 30, minutesOfDay: 23 * 60 + 30 });
    // 23:30Z is already the next day in Paris
    expect(zonedNow(new Date('2026-11-22T23:30:00Z')).date).toBe('2026-11-23');
  });
});

describe('push token routing', () => {
  it('recognises Expo tokens vs raw FCM tokens', () => {
    expect(isExpoToken('ExponentPushToken[abc123]')).toBe(true);
    expect(isExpoToken('ExpoPushToken[abc123]')).toBe(true);
    expect(isExpoToken('dGhpcyBpcyBhIGZjbSB0b2tlbg:APA91b...')).toBe(false);
  });
});
