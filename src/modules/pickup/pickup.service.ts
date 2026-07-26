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

// Contact fields exposed for a volunteer/student profile embed. Keep this
// narrow — these rows are joined into a request a member can read, so only
// expose what's needed to actually get in touch.
const CONTACT_FIELDS = 'name, email, photo_url, ghana_phone, french_phone';

// Member-facing select: the member already knows their own info, so only
// the assigned volunteer's contact card is embedded.
const MEMBER_SELECT = `*, volunteer:profiles!pickup_requests_assigned_to_profiles_fkey(${CONTACT_FIELDS})`;

// Admin-facing select: both the student who filed the request and (once
// assigned) the volunteer meeting them, so the admin list shows both at a
// glance without a second lookup.
const ADMIN_SELECT = `
  *,
  student:profiles!pickup_requests_user_id_profiles_fkey(${CONTACT_FIELDS}),
  volunteer:profiles!pickup_requests_assigned_to_profiles_fkey(${CONTACT_FIELDS})
`;

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
      .select(MEMBER_SELECT)
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

    return pickupService.finalizeRecord(request);
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
      .select(MEMBER_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw Errors.notFound('Pickup request');
    return pickupService.finalizeRecord(data);
  },

  // ── Helper: normalize a raw DB row before it goes to the frontend ──────
  // Two things happen here:
  //  1. Postgres `time` columns round-trip as "HH:mm:ss", not the "HH:mm"
  //     the frontend sends and expects back — left as-is, prefilling a form
  //     with "00:32:00" produces an invalid Date (NaN). Always trim to
  //     "HH:mm" on the way out.
  //  2. photo_url / ticket_photo_url are paths in a PRIVATE bucket, so the
  //     frontend can't render them directly — resolve short-lived signed
  //     URLs fresh on every read (not stored, since a stored signed URL
  //     would silently expire and break the UI later).
  async finalizeRecord<T extends {
    arrival_time:     string;
    photo_url:        string | null;
    ticket_photo_url: string | null;
  }>(
    record: T
  ): Promise<T & { photo_signed_url: string | null; ticket_signed_url: string | null }> {
    const [photo, ticket] = await Promise.all([
      record.photo_url
        ? supabase.storage.from(BUCKET).createSignedUrl(record.photo_url, 3600)
        : Promise.resolve(null),
      record.ticket_photo_url
        ? supabase.storage.from(BUCKET).createSignedUrl(record.ticket_photo_url, 3600)
        : Promise.resolve(null),
    ]);

    return {
      ...record,
      arrival_time:       record.arrival_time?.slice(0, 5) ?? record.arrival_time,
      photo_signed_url:   photo?.data?.signedUrl  ?? null,
      ticket_signed_url:  ticket?.data?.signedUrl ?? null,
    };
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
    return pickupService.finalizeRecord(data);
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
    return pickupService.finalizeRecord(data);
  },

// ── 6. Admin: list requests ────────────────────────────────────────────
async listRequests(query: ListPickupRequestsQuery) {
  let q = supabase
    .from('pickup_requests')
    .select(ADMIN_SELECT)                              // ← was the old inline `profiles!...` string
    .order('arrival_date', { ascending: true })
    .order('arrival_time', { ascending: true });

  if (query.status) q = q.eq('status', query.status);
  if (query.gare)   q = q.eq('gare', query.gare);
  if (query.date)   q = q.eq('arrival_date', query.date);

  const { data, error } = await q;
  if (error) throw error;
  if (!data) return [];
  return Promise.all(data.map(record => pickupService.finalizeRecord(record)));
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
    .select(ADMIN_SELECT)                               // ← was `.select()` with no embed at all
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

  return pickupService.finalizeRecord(data);
},
};