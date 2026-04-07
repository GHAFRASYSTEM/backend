import type { User } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// ── Supabase DB types (generate with: npx supabase gen types typescript) ──
export type Database = any; // replace with generated types