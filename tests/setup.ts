import { vi } from 'vitest';

// env.ts validates on import and exits on failure. Pointing dotenv at a
// missing file keeps the real .env (and its credentials) out of tests.
Object.assign(process.env, {
  DOTENV_CONFIG_PATH:    '.env.test-does-not-exist',
  NODE_ENV:              'test',
  SUPABASE_URL:          'http://localhost:54321',
  SUPABASE_SERVICE_KEY:  'test-service-key',
  FIREBASE_PROJECT_ID:   'test-project',
  FIREBASE_CLIENT_EMAIL: 'firebase@test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:  'test-private-key',
  RESEND_API_KEY:        're_test',
  RESEND_FROM_EMAIL:     'noreply@test.dev',
  STRIPE_SECRET_KEY:     'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  GROQ_API_KEY:          'gsk_test',
  GROQ_API_KEY_1:        'gsk_test_1',
  GROQ_API_KEY_2:        'gsk_test_2',
  HF_API_TOKEN:          'hf_test',
  CARD_SECRET:           'test-card-secret',
});

// firebase-admin parses the private key on init, which a dummy key fails.
vi.mock('../src/config/firebase', () => ({
  fcm: {
    sendEach:              vi.fn().mockResolvedValue({ successCount: 0, failureCount: 0 }),
    sendEachForMulticast:  vi.fn().mockResolvedValue({ successCount: 0, failureCount: 0 }),
  },
}));
