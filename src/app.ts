import express             from 'express';
import cors                from 'cors';
import helmet              from 'helmet';
import morgan              from 'morgan';
import { env }             from './config/env';
import authRouter          from './modules/auth/auth.router';
import duesRouter          from './modules/dues/dues.router';
import transactionsRouter  from './modules/transactions/transactions.router';
import announcementsRouter from './modules/announcements/announcements.router';
import housingRouter       from './modules/housing/housing.router';
import membersRouter       from './modules/members/members.router';
import frenchAIRouter      from './modules/french-ai/french-ai.router';
import interviewRouter     from './modules/interview/interview.routes';
import pickupRouter        from './modules/pickup/pickup.router';
import opportunitiesRouter from './modules/opportunities/opportunities.router';
import { organizationFinanceRouter } from './modules/organization-finance/organization-finance.router';
import attendanceRouter from './modules/attendance/attendance.router';
import notificationsRouter from './modules/notifications/notifications.router';
import settingsRouter      from './modules/settings/settings.router';
import { errorHandler }    from './middleware/error.middleware';
import { runAllJobsOnce }   from './jobs';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
if (env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Raw body for the webhook MUST come before express.json(),
// otherwise signature verification fails
app.use('/dues/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

app.use('/auth',          authRouter);
app.use('/dues',          duesRouter);
app.use('/transactions',  transactionsRouter);
app.use('/announcements', announcementsRouter);
app.use('/members',       membersRouter);
app.use('/housing',       housingRouter);
app.use('/french-ai',     frenchAIRouter);
app.use('/interview',     interviewRouter);
app.use('/pickup',        pickupRouter);
app.use('/finance',       organizationFinanceRouter);
app.use('/opportunities', opportunitiesRouter);
app.use('/attendance', attendanceRouter);
app.use('/notifications', notificationsRouter);
app.use('/settings',      settingsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Crash/error reports from the mobile app (no auth: errors can happen before
// sign-in). Small payloads, rate-limited per IP; written to the server log.
const errorHits = new Map<string, { n: number; at: number }>();
app.post('/client-errors', (req, res) => {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const hit = errorHits.get(ip);
  if (hit && now - hit.at < 60_000) {
    if (++hit.n > 30) return res.status(429).end();
  } else errorHits.set(ip, { n: 1, at: now });

  const b = (req.body ?? {}) as Record<string, unknown>;
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  console.error('[client-error]', JSON.stringify({
    message: clip(b.message, 1000), source: clip(b.source, 40), isFatal: !!b.isFatal,
    platform: clip(b.platform, 20), osVersion: clip(b.osVersion, 20), appVersion: clip(b.appVersion, 20),
    stack: clip(b.stack, 4000),
  }));
  return res.status(204).end();
});

// External scheduler hook (free hosting sleeps → node-cron alone can't be trusted).
// Auth: header "x-jobs-secret" or ?key= must equal JOBS_SECRET.
app.all('/jobs/tick', async (req, res, next) => {
  try {
    const key = req.header('x-jobs-secret') ?? (typeof req.query.key === 'string' ? req.query.key : '');
    if (!env.JOBS_SECRET || key !== env.JOBS_SECRET) return res.status(401).json({ success: false });
    // Answer right away (free schedulers time out after ~30 s), then do the work
    res.status(202).json({ success: true, data: { started: true } });
    runAllJobsOnce()
      .then(r => console.log('[jobs/tick]', JSON.stringify(r)))
      .catch(err => console.error('[jobs/tick] failed:', err?.message ?? err));
  } catch (err) { next(err); }
});

app.use(errorHandler);

export default app;