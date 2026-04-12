import { supabase } from '../../config/supabase';
import { Errors }   from '../../shared/errors';

type Filters = {
  month?: number;
  year?:  number;
  type?:  'dues' | 'donation';
};

export const transactionsService = {

  // ── Get all payments for user (optionally filtered by type) ─────────────
  async getUserPayments(userId: string, filters: Filters = {}) {
    let query = supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId);

    if (filters.type)  query = query.eq('type',  filters.type);
    if (filters.month) query = query.eq('month', filters.month);
    if (filters.year)  query = query.eq('year',  filters.year);

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  // ── Get single payment by ID (must belong to user) ──────────────────────
  async getPaymentById(userId: string, id: string) {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw Errors.notFound('Payment');
    return data;
  },

  // ── Admin: Get all payments with optional filters ───────────────────────
  async getAllPayments(filters: Filters) {
    let query = supabase
      .from('payments')
      .select(`
        *,
        profiles (
          id,
          name,
          email,
          region
        )
      `);

    if (filters.type)  query = query.eq('type',  filters.type);
    if (filters.month) query = query.eq('month', filters.month);
    if (filters.year)  query = query.eq('year',  filters.year);

    const { data, error } = await query
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },
};