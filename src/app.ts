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
import { errorHandler }    from './middleware/error.middleware';

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

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

export default app;