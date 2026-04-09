import { supabase } from '../../config/supabase';
import { Errors }   from '../../shared/errors';
import { notificationService } from '../notifications/notifications.service';
import type { ListMembersInput, UpdateMemberInput } from './members.schema';

export const membersService = {

  // ── List members with filtering + pagination ──────────────────────────
  async listMembers(input: ListMembersInput) {
    const {
      page, limit,
      search, region, gender, role, member_type,
      is_verified, is_complete,
      member_since_from, member_since_to,
      created_from, created_to,
      sort_by, sort_order,
    } = input;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('profiles')
      .select(`
        id, email, name, photo_url, gender,
        ghana_phone, french_phone, city, occupation,
        region, role, member_type, is_complete,
        is_verified, member_since, created_at, updated_at
      `, { count: 'exact' });

    // ── Search: name or email ───────────────────────────────────────────
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // ── Filters ─────────────────────────────────────────────────────────
    if (region)      query = query.eq('region',      region);
    if (gender)      query = query.eq('gender',      gender);
    if (role)        query = query.eq('role',        role);
    if (member_type) query = query.eq('member_type', member_type);

    if (is_verified !== undefined) query = query.eq('is_verified', is_verified);
    if (is_complete !== undefined) query = query.eq('is_complete', is_complete);

    // ── Date range filters ───────────────────────────────────────────────
    if (member_since_from) query = query.gte('member_since', member_since_from);
    if (member_since_to)   query = query.lte('member_since', member_since_to);
    if (created_from)      query = query.gte('created_at',   created_from);
    if (created_to)        query = query.lte('created_at',   created_to);

    // ── Sort + paginate ──────────────────────────────────────────────────
    query = query
      .order(sort_by, { ascending: sort_order === 'asc' })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[members] listMembers error:', error);
      throw error;
    }

    return {
      members:  data ?? [],
      total:    count ?? 0,
      page,
      limit,
      pages:    Math.ceil((count ?? 0) / limit),
    };
  },

  // ── Get single member ─────────────────────────────────────────────────
  async getMember(memberId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', memberId)
      .single();

    if (error || !data) throw Errors.notFound('Member');
    return data;
  },

  // ── Update any member field ───────────────────────────────────────────
  async updateMember(memberId: string, input: UpdateMemberInput) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, name, email, is_verified')
      .eq('id', memberId)
      .single();

    if (!existing) throw Errors.notFound('Member');

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single();

    if (error) {
      console.error('[members] updateMember error:', error);
      throw error;
    }

    return data;
  },

  // ── Toggle verified status ────────────────────────────────────────────
  async toggleVerified(memberId: string, isVerified: boolean) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, name, email, is_verified')
      .eq('id', memberId)
      .single();

    if (!existing) throw Errors.notFound('Member');

    // No-op if already in desired state
    if (existing.is_verified === isVerified) {
      return existing;
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        is_verified: isVerified,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single();

    if (error) throw error;

    // Notify member when verified
    if (isVerified) {
      await notificationService.sendToUser(memberId, {
        title: '✅ Account Verified',
        body:  `Hi ${existing.name}, your GHAFRA membership has been verified!`,
      }).catch(console.error);
    }

    return data;
  },

  // ── Delete member (hard delete — removes from auth too) ───────────────
  async deleteMember(memberId: string) {
    // Deleting from auth.users cascades to profiles via FK
    const { error } = await supabase.auth.admin.deleteUser(memberId);
    if (error) throw error;
    return { deleted: true, id: memberId };
  },

  // ── Summary stats for admin dashboard ────────────────────────────────
  async getStats() {
    const [
      { count: total },
      { count: verified },
      { count: complete },
      regionData,
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_verified', true),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_complete', true),
      supabase.from('profiles').select('region'),
    ]);

    // Count per region
    const byRegion: Record<string, number> = {};
    for (const row of regionData.data ?? []) {
      if (row.region) byRegion[row.region] = (byRegion[row.region] ?? 0) + 1;
    }

    return {
      total:      total    ?? 0,
      verified:   verified ?? 0,
      complete:   complete ?? 0,
      incomplete: (total ?? 0) - (complete ?? 0),
      by_region:  byRegion,
    };
  },
};