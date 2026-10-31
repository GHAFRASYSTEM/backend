import { randomUUID }          from 'crypto';
import { supabase }            from '../../config/supabase';
import { notificationService } from '../notifications/notifications.service';
import { AppError, Errors }    from '../../shared/errors';
import {
  IMAGE_BUCKET,
  detectImage,
  storagePathFromPublicUrl,
  assertSingleImageSource,
} from './opportunities.image';
import {
  TRANSITIONS,
  EDITABLE_STATUSES,
  assertTransition,
  assertEditable,
  assertPublishable,
  todayInParis,
  withAvailability,
  type OpportunityAction,
} from './opportunities.rules';
import {
  missingApplicationDetail,
  type CreateOpportunityInput,
  type UpdateOpportunityInput,
  type MemberListQuery,
  type AdminListQuery,
} from './opportunities.schema';

const TABLE = 'opportunities';

// Members never see who authored a listing or internal timestamps.
const MEMBER_SELECT = `
  id, title, organization, type, description, qualifications, skills, location,
  application_deadline, application_method, application_url, application_email,
  application_instructions, contact_name, contact_email, contact_phone, image_url,
  status, published_at, closed_at, created_at, updated_at
`;

const ADMIN_SELECT = `
  *,
  creator:profiles!opportunities_created_by_profiles_fkey(id, name, email),
  updater:profiles!opportunities_updated_by_profiles_fkey(id, name, email)
`;

const CONCURRENT_UPDATE = () =>
  Errors.conflict('This opportunity was changed by someone else. Reload and try again.');

// Free text ends up inside PostgREST filter strings (`or=(...)`), where commas,
// parentheses and quotes are syntax, and inside ILIKE, where % and _ are
// wildcards. Keep only characters that are meaningful in a search.
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}\s\-'.@+&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageRange(page: number, limit: number) {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}

function openDeadlineFilter(today: string) {
  return `application_deadline.is.null,application_deadline.gte.${today}`;
}

function applyCommonFilters<Q extends { eq: Function; ilike: Function; or: Function }>(
  query: Q,
  filters: Pick<MemberListQuery, 'type' | 'location' | 'search'>,
): Q {
  if (filters.type) query = query.eq('type', filters.type);

  const location = filters.location && sanitizeSearchTerm(filters.location);
  if (location) query = query.ilike('location', `%${location}%`);

  const search = filters.search && sanitizeSearchTerm(filters.search);
  if (search) query = query.or(`title.ilike.%${search}%,organization.ilike.%${search}%`);

  return query;
}

async function storeImage(opportunityId: string, buffer: Buffer): Promise<string> {
  const { ext, mime } = detectImage(buffer);
  const path = `${opportunityId}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert:      false,
  });
  if (error) throw Errors.internal(`Image upload failed: ${error.message}`);

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Only objects we uploaded (public URL on our bucket) are removed.
function forgetImage(url: string | null | undefined) {
  const path = storagePathFromPublicUrl(url);
  if (!path) return;
  supabase.storage
    .from(IMAGE_BUCKET)
    .remove([path])
    .then(({ error }) => {
      if (error) console.error('[opportunities] image delete failed:', error.message);
    });
}

function logAudit(adminId: string, action: string, opportunity: { id: string; title: string }) {
  supabase
    .from('admin_audit_log')
    .insert({
      admin_id: adminId,
      action:   `opportunity.${action}`,
      detail:   `${opportunity.title} (${opportunity.id})`,
    })
    .then(({ error }) => {
      if (error) console.error('[opportunities] audit log failed:', error.message);
    });
}

function notifyMembersOfNewOpportunity(opportunity: {
  id: string; title: string; organization: string; type: string;
}) {
  notificationService
    .broadcast(
      {
        title: opportunity.type === 'internship' ? '🎓 New internship opportunity' : '💼 New job opportunity',
        body:  `${opportunity.title} at ${opportunity.organization}`,
      },
      { type: 'opportunity', opportunity_id: opportunity.id },
    )
    .catch(err => console.error('[opportunities] push broadcast failed:', err));
}

export const opportunitiesService = {

  // ── Member: list open opportunities ───────────────────────────────────
  // "Open" = published AND (no deadline OR deadline is today or later).
  async listPublished(query: MemberListQuery) {
    const today        = todayInParis();
    const { from, to } = pageRange(query.page, query.limit);

    let q = supabase
      .from(TABLE)
      .select(MEMBER_SELECT, { count: 'exact' })
      .eq('status', 'published')
      .or(openDeadlineFilter(today));

    q = applyCommonFilters(q, query);

    const { data, error, count } = await q
      .order('published_at', { ascending: false })
      .order('id',           { ascending: true })
      .range(from, to);

    if (error) throw error;
    return {
      data:  (data ?? []).map(row => withAvailability(row, today)),
      total: count ?? 0,
    };
  },

  // ── Member: one opportunity ───────────────────────────────────────────
  // Drafts and archived rows are indistinguishable from missing ones (404).
  // Closed or expired listings return 410 so the app can say "this has closed"
  // when a member opens an old link or notification.
  async getPublished(id: string) {
    const { data, error } = await supabase
      .from(TABLE)
      .select(MEMBER_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.status === 'draft' || data.status === 'archived') {
      throw Errors.notFound('Opportunity');
    }

    const record = withAvailability(data, todayInParis());
    if (record.availability !== 'open') {
      throw new AppError('This opportunity is no longer accepting applications', 410, 'OPPORTUNITY_UNAVAILABLE');
    }
    return record;
  },

  // ── Admin: list everything ────────────────────────────────────────────
  async listAll(query: AdminListQuery) {
    const today        = todayInParis();
    const { from, to } = pageRange(query.page, query.limit);

    let q = supabase
      .from(TABLE)
      .select(ADMIN_SELECT, { count: 'exact' });

    if (query.status) q = q.eq('status', query.status);

    if (query.expired === true) {
      q = q.eq('status', 'published').lt('application_deadline', today);
    } else if (query.expired === false) {
      q = q.or(openDeadlineFilter(today));
    }

    q = applyCommonFilters(q, query);

    const { data, error, count } = await q
      .order(query.sort_by, { ascending: query.sort_order === 'asc', nullsFirst: false })
      .order('id',          { ascending: true })
      .range(from, to);

    if (error) throw error;
    return {
      data:  (data ?? []).map(row => withAvailability(row, today)),
      total: count ?? 0,
    };
  },

  // ── Admin: one opportunity ────────────────────────────────────────────
  async getById(id: string) {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ADMIN_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw Errors.notFound('Opportunity');
    return withAvailability(data, todayInParis());
  },

  // ── Admin: create (always a draft) ────────────────────────────────────
  async create(adminId: string, input: CreateOpportunityInput, file?: Buffer) {
    assertSingleImageSource(file, input.image_url !== undefined);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        ...input,
        qualifications:       input.qualifications       ?? [],
        skills:               input.skills               ?? [],
        application_deadline: input.application_deadline ?? null,
        image_url:            input.image_url            ?? null,
        status:               'draft',
        created_by:           adminId,
        updated_by:           adminId,
      })
      .select(ADMIN_SELECT)
      .single();

    if (error) throw error;
    if (!file) {
      logAudit(adminId, 'create', data);
      return withAvailability(data, todayInParis());
    }

    // The row exists so the object path can be keyed by its id. If the upload
    // or the follow-up update fails, drop the row so a retry doesn't leave a
    // draft the client never received.
    let uploadedUrl: string | null = null;
    try {
      uploadedUrl = await storeImage(data.id, file);
      const { data: updated, error: updateError } = await supabase
        .from(TABLE)
        .update({ image_url: uploadedUrl })
        .eq('id', data.id)
        .select(ADMIN_SELECT)
        .single();
      if (updateError) throw updateError;

      logAudit(adminId, 'create', updated);
      return withAvailability(updated, todayInParis());
    } catch (err) {
      if (uploadedUrl) forgetImage(uploadedUrl);
      await supabase.from(TABLE).delete().eq('id', data.id);
      throw err;
    }
  },

  // ── Admin: edit fields (not status) ───────────────────────────────────
  async update(adminId: string, id: string, input: UpdateOpportunityInput, file?: Buffer) {
    const { data: existing, error: readError } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (readError) throw readError;
    if (!existing) throw Errors.notFound('Opportunity');
    assertEditable(existing.status);
    assertSingleImageSource(file, input.image_url !== undefined);

    // A partial update can change the method without its matching detail
    // (or clear the detail), so validate against the merged result
    // before uploading anything.
    const missing = missingApplicationDetail({ ...existing, ...input });
    if (missing) {
      throw new AppError(
        `${missing} is required when application_method is "${input.application_method ?? existing.application_method}"`,
        422,
        'VALIDATION_ERROR',
      );
    }

    let uploadedUrl: string | null = null;
    if (file) {
      uploadedUrl = await storeImage(id, file);
      input = { ...input, image_url: uploadedUrl };
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...input, updated_by: adminId })
      .eq('id', id)
      .in('status', EDITABLE_STATUSES)
      .select(ADMIN_SELECT)
      .maybeSingle();

    if (error || !data) {
      if (uploadedUrl) forgetImage(uploadedUrl);
      if (error) throw error;
      throw CONCURRENT_UPDATE();
    }

    if (input.image_url !== undefined && existing.image_url !== input.image_url) {
      forgetImage(existing.image_url);
    }

    logAudit(adminId, 'update', data);
    return withAvailability(data, todayInParis());
  },

  // ── Admin: publish / close / archive ──────────────────────────────────
  async transition(adminId: string, id: string, action: OpportunityAction) {
    const { data: existing, error: readError } = await supabase
      .from(TABLE)
      .select('id, status, application_deadline, published_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) throw readError;
    if (!existing) throw Errors.notFound('Opportunity');

    const today = todayInParis();
    assertTransition(existing.status, action);
    if (action === 'publish') assertPublishable(existing.application_deadline, today);

    const now   = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status:     TRANSITIONS[action].to,
      updated_by: adminId,
    };
    if (action === 'publish') {
      patch.published_at = existing.published_at ?? now;
      patch.closed_at    = null;
    }
    if (action === 'close')   patch.closed_at   = now;
    if (action === 'archive') patch.archived_at = now;

    // Compare-and-set on the status we just read: if another admin changed it
    // in between, nothing is updated and we report a conflict rather than
    // overwrite their change (or send a second "new opportunity" push).
    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('id', id)
      .eq('status', existing.status)
      .select(ADMIN_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw CONCURRENT_UPDATE();

    if (action === 'publish' && !existing.published_at) notifyMembersOfNewOpportunity(data);
    logAudit(adminId, action, data);

    return withAvailability(data, today);
  },
};
