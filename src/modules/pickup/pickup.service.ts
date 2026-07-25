import { supabase }            from '../../config/supabase';
import { notificationService } from '../notifications/notifications.service';
import { Errors }              from '../../shared/errors';
import type {
  CreatePickupRequestInput,
  UpdatePickupRequestInput,
  UploadUrlRequestInput,
  AdminUpdateStatusInput,
  ListPickupRequestsQuery,
} from './pickup.schema';

const BUCKET = 'pickup-photos';
const ACTIVE_STATUSES = ['pending', 'assigned'];

export const pickupService = {

  // ── 1. Signed upload URL ──────────────────────────────────────────────
  // The frontend uploads the raw file straight to Supabase Storage using
  // this URL, then submits the returned `path` back to us in create/update.
  async createUploadUrl(userId: string, input: UploadUrlRequestInput) {
    const ext  = (input.filename.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/${input.kind}-${Date.now()}.${ext}`;

    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true });

    if (error || !data) throw Errors.badRequest('Could not create upload URL');

    return {
      path,
      signed_url: data.signedUrl,
      token:      data.token,
    };
  },

  // ── 2. Create pickup request ──────────────────────────────────────────
  async createRequest(userId: string, input: CreatePickupRequestInput) {
    const { data: existingActive } = await supabase
      .from('pickup_requests')
      .select('id')
      .eq('user_id', userId)
      .in('status', ACTIVE_STATUSES)
      .maybeSingle();

    if (existingActive) {
      throw Errors.conflict('You already have an active pickup request. Update or cancel it first.');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .single();

    const { data: request, error } = await supabase
      .from('pickup_requests')
      .insert({
        user_id:          userId,
        phone:            input.phone,
        arrival_date:     input.arrival_date,
        arrival_time:     input.arrival_time,
        train_number:     input.train_number,
        gare:             input.gare,
        expected_luggage: input.expected_luggage ?? null,
        house_address:    input.house_address,
        photo_url:        input.photo_url        ?? null,
        ticket_photo_url: input.ticket_photo_url  ?? null,
        status:           'pending',
      })
      .select()
      .single();

    if (error) throw error;

    // Notify admins there's a new pickup to coordinate.
    // Fire-and-forget; a notification failure shouldn't fail the request.
    pickupService
      .notifyAdmins({
        title: '🚗 New pickup request',
        body:  `${profile?.name || 'A member'} needs pickup at ${input.gare} on ${input.arrival_date} ${input.arrival_time}.`,
      })
      .catch(err => console.error('[pickup] admin notify failed:', err));

    return request;
  },

  // ── Helper: notify every admin individually ───────────────────────────
  // notificationService only exposes sendToUser/broadcast, so we resolve
  // the admin user ids ourselves and fan out sendToUser calls.
  async notifyAdmins(notification: { title: string; body: string }) {
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin');

    if (!admins?.length) return;

    await Promise.allSettled(
      admins.map(admin => notificationService.sendToUser(admin.id, notification))
    );
  },

  // ── 3. Get my active/most-recent request ──────────────────────────────
  async getMyRequest(userId: string) {
    const { data, error } = await supabase
      .from('pickup_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw Errors.notFound('Pickup request');
    return data;
  },

  // ── 4. Update my request (only while pending) ─────────────────────────
  async updateMyRequest(userId: string, input: UpdatePickupRequestInput) {
    const { data: existing } = await supabase
      .from('pickup_requests')
      .select('id, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) throw Errors.notFound('Pickup request');
    if (existing.status !== 'pending') {
      throw Errors.conflict('This request can no longer be edited.');
    }

    const { data, error } = await supabase
      .from('pickup_requests')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ── 5. Cancel my request ───────────────────────────────────────────────
  async cancelMyRequest(userId: string) {
    const { data: existing } = await supabase
      .from('pickup_requests')
      .select('id, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) throw Errors.notFound('Pickup request');
    if (!ACTIVE_STATUSES.includes(existing.status)) {
      throw Errors.conflict('This request is already closed.');
    }

    const { data, error } = await supabase
      .from('pickup_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ── 6. Admin: list requests ────────────────────────────────────────────
  async listRequests(query: ListPickupRequestsQuery) {
    let q = supabase
      .from('pickup_requests')
      .select('*, profiles!pickup_requests_user_id_fkey(name, email, ghana_phone)')
      .order('arrival_date', { ascending: true })
      .order('arrival_time', { ascending: true });

    if (query.status) q = q.eq('status', query.status);
    if (query.gare)   q = q.eq('gare', query.gare);
    if (query.date)   q = q.eq('arrival_date', query.date);

    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  // ── 7. Admin: update status / assign ───────────────────────────────────
  async adminUpdateStatus(requestId: string, input: AdminUpdateStatusInput) {
    const { data: existing } = await supabase
      .from('pickup_requests')
      .select('id, user_id')
      .eq('id', requestId)
      .single();

    if (!existing) throw Errors.notFound('Pickup request');

    const { data, error } = await supabase
      .from('pickup_requests')
      .update({
        status:      input.status,
        assigned_to: input.assigned_to ?? null,
        admin_notes: input.admin_notes ?? null,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;

    if (input.status === 'assigned') {
      notificationService
        .sendToUser(existing.user_id, {
          title: '✅ Your pickup is arranged',
          body:  'A GHAFRA volunteer has been assigned to meet you at the station.',
        })
        .catch(err => console.error('[pickup] user notify failed:', err));
    }

    return data;
  },
};