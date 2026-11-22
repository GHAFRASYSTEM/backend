import { supabase } from '../../config/supabase';
import { Errors }   from '../../shared/errors';

/**
 * App-wide feature switches. DEFAULTS is the source of truth for which keys
 * exist and what the app gets when a row is missing (or the table isn't migrated).
 */
export type AppSettings = {
  card_section_enabled: boolean;
};

export const DEFAULTS: AppSettings = {
  card_section_enabled: true,
};

export type SettingKey = keyof AppSettings;

// Short in-process cache: the app reads this on every launch / foreground
let cache: { value: AppSettings; at: number } | null = null;
const TTL_MS = 30_000;

export const settingsService = {
  async getAll(): Promise<AppSettings> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

    const { data, error } = await supabase.from('app_settings').select('key, value');
    if (error) {
      console.warn('[settings] read failed, using defaults:', error.message);
      return { ...DEFAULTS };
    }

    const value = { ...DEFAULTS } as Record<string, unknown>;
    for (const row of data ?? []) {
      if (row.key in DEFAULTS) value[row.key] = row.value;
    }
    cache = { value: value as AppSettings, at: Date.now() };
    return cache.value;
  },

  async update(patch: Partial<AppSettings>, adminId: string): Promise<AppSettings> {
    const rows = Object.entries(patch).map(([key, value]) => ({
      key, value, updated_by: adminId, updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw Errors.internal(error.message);
    }
    cache = null;
    return settingsService.getAll();
  },
};
