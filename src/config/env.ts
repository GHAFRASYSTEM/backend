import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT:                  z.string().default('5000'),
  NODE_ENV:              z.enum(['development', 'production', 'test']).default('development'),

  // Supabase
  SUPABASE_URL:          z.string().url(),
  SUPABASE_SERVICE_KEY:  z.string().min(1),

  // Firebase FCM
  FIREBASE_PROJECT_ID:   z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY:  z.string().min(1),

  // Resend
  RESEND_API_KEY:        z.string().min(1),
  RESEND_FROM_EMAIL:     z.string().email(),

  // Stripe
  STRIPE_SECRET_KEY:     z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  //Grok
  GROQ_API_KEY: z.string().min(1),
    GROQ_API_KEY_1: z.string().min(1),
    GROQ_API_KEY_2: z.string().min(1),

  //hugging Face
  HF_API_TOKEN: z.string().min(1),

  //Card authenticatio,
   CARD_SECRET:           z.string().min(1),

  // ── Push (optional) — raises Expo push rate limits when set ──────────────
  EXPO_ACCESS_TOKEN:     z.string().optional(),

  // ── Scheduling ───────────────────────────────────────────────────────────
  APP_TIMEZONE:          z.string().default('Europe/Paris'),
  // Set to "false" on extra instances so only one runs the cron jobs
  RUN_JOBS:              z.string().default('true'),
  // Shared secret for POST /jobs/tick (external free scheduler, e.g. cron-job.org)
  JOBS_SECRET:           z.string().min(16).optional(),
  // Shown as the sender name in emails
  APP_NAME:              z.string().default('GHAFRA'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Missing or invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;