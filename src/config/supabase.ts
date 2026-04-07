import { createClient } from '@supabase/supabase-js';
import { env }          from './env';
import type { Database } from '../shared/types';

// Service-role client — backend only, never expose to frontend
export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  }
);