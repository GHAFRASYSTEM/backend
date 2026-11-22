import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/firebase', () => ({ fcm: { sendEachForMulticast: vi.fn() } }));
const notify = vi.fn().mockResolvedValue({});
vi.mock('../../src/modules/notifications/notifications.service', () => ({ notify: (...a: unknown[]) => notify(...a) }));
vi.mock('../../src/modules/settings/settings.service', () => ({ settingsService: { getAll: async () => ({ card_section_enabled: true }) } }));

import { runDuesReminder } from '../../src/jobs/dues-reminder.job';

// 09:30 Paris on a given day (winter, UTC+1)
const at = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T08:30:00Z`));

describe('dues reminder schedule', () => {
  beforeEach(() => { vi.useFakeTimers(); notify.mockClear(); });

  it('sends on Mon/Wed/Fri mid-month, push only', async () => {
    at('2026-12-07'); await runDuesReminder();   // Monday
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].channels).toEqual(['push']);
  });

  it('skips Tue/Thu/weekends mid-month', async () => {
    for (const d of ['2026-12-08', '2026-12-10', '2026-12-12', '2026-12-13']) { at(d); await runDuesReminder(); }
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends every day in the last 7 days, with email', async () => {
    for (const d of ['2026-12-25', '2026-12-26', '2026-12-27', '2026-12-31']) { at(d); await runDuesReminder(); }
    expect(notify).toHaveBeenCalledTimes(4);
    expect(notify.mock.calls.every(c => c[0].channels.includes('email'))).toBe(true);
    expect(notify.mock.calls[3][0].title).toMatch(/Last day/);
  });

  it('never sends before 09:00', async () => {
    vi.setSystemTime(new Date('2026-12-31T06:00:00Z')); await runDuesReminder();
    expect(notify).not.toHaveBeenCalled();
  });
});
