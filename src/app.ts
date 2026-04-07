import express            from 'express';
import cors               from 'cors';
import helmet             from 'helmet';
import morgan             from 'morgan';
import { env }            from './config/env';
import authRouter         from './modules/auth/auth.router';
import duesRouter         from './modules/dues/dues.router';
import transactionsRouter from './modules/transactions/transactions.router';
import announcementsRouter from './modules/announcements/announcements.router'; // ← add
import { errorHandler }   from './middleware/error.middleware';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));  

app.use('/dues/webhook', express.raw({ type: 'application/json' }));

app.use('/auth',          authRouter);
app.use('/dues',          duesRouter);
app.use('/transactions',  transactionsRouter);
app.use('/announcements', announcementsRouter);   // ← add

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`🚀 GHAFRA API running on port ${env.PORT}`);
});

export default app;