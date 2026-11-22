/**
 * Background jobs. Started once from server.ts (skip with RUN_JOBS=false on
 * extra instances). Every job is idempotent through notification jobKeys, so
 * overlapping runs or restarts never double-send.
 */
import cron from 'node-cron';
import { env } from '../config/env';
import { runMeetingCountdown }      from './meeting-countdown.job';
import { runAttendanceReminders }   from './attendance-reminders.job';
import { runDuesReminder }          from './dues-reminder.job';
import { runFrenchPracticeReminder } from './french-practice.job';

function guard(name: string, fn: () => Promise<void>) {
  let running = false;
  return async () => {
    if (running) return;          // skip if the previous tick is still going
    running = true;
    try { await fn(); }
    catch (err: any) { console.error(`[jobs] ${name} failed:`, err?.message ?? err); }
    finally { running = false; }
  };
}

export function startJobs() {
  if (env.RUN_JOBS === 'false' || env.NODE_ENV === 'test') {
    console.log('[jobs] disabled (RUN_JOBS=false)');
    return;
  }

  const opts = { timezone: env.APP_TIMEZONE };

  cron.schedule('* * * * *',   guard('attendance-reminders', () => runAttendanceReminders()), opts);
  cron.schedule('*/5 * * * *', guard('meeting-countdown',    runMeetingCountdown),           opts);
  cron.schedule('0 10 * * *',  guard('dues-reminder',        runDuesReminder),               opts);
  cron.schedule('0 19 * * *',  guard('french-practice',      runFrenchPracticeReminder),     opts);

  console.log(`⏰ Jobs scheduled (${env.APP_TIMEZONE}): attendance reminders, meeting countdown, dues, French practice`);
}

export { runAttendanceReminders };
