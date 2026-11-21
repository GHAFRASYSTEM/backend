import 'dotenv/config';
import app     from './app';
import { env } from './config/env';
import { initializePronunciationPhrases } from './modules/french-ai/french-ai.data';

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
  process.exit(1);
});

async function startServer() {
  try {
    console.log('Initializing French AI Tutor data...');
    await initializePronunciationPhrases();
    console.log('✅ French AI pronunciation phrases loaded successfully');

    const port = Number(process.env.PORT ?? env.PORT ?? 3000);

    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 GHAFRA API running on port ${port}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();