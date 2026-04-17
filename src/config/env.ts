import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT:                  z.string().default('3000'),
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

  //hugging Face
  HF_API_TOKEN: z.string().min(1),

  //Card authenticatio,
   CARD_SECRET:           z.string().min(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Missing or invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;