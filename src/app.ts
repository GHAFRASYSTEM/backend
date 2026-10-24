import express            from 'express';
import cors               from 'cors';
import helmet             from 'helmet';
import morgan             from 'morgan';
import { env }            from './config/env';
import authRouter         from './modules/auth/auth.router';
import duesRouter         from './modules/dues/dues.router';
import transactionsRouter from './modules/transactions/transactions.router';
import announcementsRouter from './modules/announcements/announcements.router';
import housingRouter from './modules/housing/housing.router';
import membersRouter from './modules/members/members.router';
import frenchAIRouter from './modules/french-ai/french-ai.router';
import interviewRouter    from './modules/interview/interview.routes';
import pickupRouter from './modules/pickup/pickup.router';
import { errorHandler }   from './middleware/error.middleware';

import { organizationFinanceRouter } from './modules/organization-finance/organization-finance.router';

// Import the initialization function
import { initializePronunciationPhrases } from './modules/french-ai/french-ai.data';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));  

app.use('/dues/webhook', express.raw({ type: 'application/json' }));

app.use('/auth',          authRouter);
app.use('/dues',          duesRouter);
app.use('/transactions',  transactionsRouter);
app.use('/announcements', announcementsRouter);
app.use('/members',       membersRouter);
app.use('/housing',       housingRouter);
app.use('/french-ai',     frenchAIRouter);
app.use('/interview',     interviewRouter);
app.use('/pickup', pickupRouter);
app.use('/organization-finance', organizationFinanceRouter);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

/**
 * Start the server with proper async initialization
 */
async function startServer() {
  try {
    console.log('Initializing French AI Tutor data...');
    
    // ←←← THIS IS THE IMPORTANT LINE
    await initializePronunciationPhrases();

    console.log('✅ French AI pronunciation phrases loaded successfully');

    app.listen(env.PORT, () => {
      console.log(`🚀 GHAFRA API running on port ${env.PORT}`);
    });

  } catch (error) {
    console.error('❌ Failed to initialize French AI data:', error);
    process.exit(1); // Exit if critical data fails to load
  }
}

// Start the application
startServer();

export default app;