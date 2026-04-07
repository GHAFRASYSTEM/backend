import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import morgan         from 'morgan';
import { env }        from './config/env';
import authRouter     from './modules/auth/auth.router';
import duesRouter       from './modules/dues/dues.router';
import transactionsRouter from './modules/transactions/transactions.router';
import { errorHandler } from './middleware/error.middleware';

const app = express();

// ── Global middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));   // tighten in production
app.use(morgan('dev'));
app.use(express.json());

// ── Raw body for Stripe webhook ONLY ─────────────────────────────────────
app.use('/dues/webhook', express.raw({ type: 'application/json' }));


// ── Routes ────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/dues', duesRouter);
app.use('/transactions', transactionsRouter);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Global error handler ──────────────────────────────────────────────────
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`🚀 GHAFRA API running on port ${env.PORT}`);
});

export default app;