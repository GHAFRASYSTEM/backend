import app     from './app';
import { env } from './config/env';
import { initializePronunciationPhrases } from './modules/french-ai/french-ai.data';

async function startServer() {
  try {
    console.log('Initializing French AI Tutor data...');
    await initializePronunciationPhrases();
    console.log('✅ French AI pronunciation phrases loaded successfully');

    app.listen(env.PORT, () => {
      console.log(`🚀 GHAFRA API running on port ${env.PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize French AI data:', error);
    process.exit(1);
  }
}

startServer();
