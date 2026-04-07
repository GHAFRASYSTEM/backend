import { supabase }  from '../../config/supabase';
import { Errors }    from '../../shared/errors';
import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  PaginationInput,
} from './announcements.schema';

const TABLE  = 'announcements';
const BUCKET = 'announcements';

// ── Image helpers ─────────────────────────────────────────────────────────────

/**
 * Accepts either:
 *  - a base64 data URI  → data:image/jpeg;base64,/9j/...
 *  - raw base64 string  → /9j/...
 * Uploads to Supabase Storage and returns the public URL.
 */
async function uploadImage(
  raw: string,
  announcementId: string,
): Promise<string> {
  let base64Data: string;
  let mimeType = 'image/jpeg';

  if (raw.startsWith('data:')) {
    const [header, data] = raw.split(',');
    const mimeMatch = header.match(/data:([^;]+);base64/);
    if (!mimeMatch) throw Errors.badRequest('Invalid image data URI');
    mimeType   = mimeMatch[1];
    base64Data = data;
  } else {
    base64Data = raw;
  }

  const ext        = mimeType.split('/')[1] ?? 'jpg';
  const path       = `${announcementId}/cover.${ext}`;
  const buffer     = Buffer.from(base64Data, 'base64');

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType:  mimeType,
      upsert:       true,       // overwrite on update
    });

  if (error) throw Errors.internal(`Image upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  return urlData.publicUrl;
}

async function deleteImage(announcementId: string): Promise<void> {
  // List everything under the announcement folder and remove it
  const { data: files } = await supabase.storage
    .from(BUCKET)
    .list(announcementId);

  if (!files?.length) return;

  const paths = files.map(f => `${announcementId}/${f.name}`);
  await supabase.storage.from(BUCKET).remove(paths);
}

// ── Service ───────────────────────────────────────────────────────────────────

export const announcementsService = {

  // GET all — paginated, latest first
  async getAll(pagination: PaginationInput) {
    const { page, limit } = pagination;
    const from = (page - 1) * limit;
    const to   = from + limit - 1;

    const { data, error, count } = await supabase
      .from(TABLE)
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false })
      .range(from, to);

    if (error) throw Errors.internal(error.message);

    return { data: data ?? [], total: count ?? 0 };
  },

  // GET one by id
  async getById(id: string) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw Errors.notFound('Announcement not found');
    return data;
  },

  // POST — admin only
  async create(
    input:    CreateAnnouncementInput,
    imageRaw: string | undefined,
  ) {
    // Insert first to get the ID, then upload image using the ID as folder
    const { data: inserted, error: insertError } = await supabase
      .from(TABLE)
      .insert({
        category:     input.category,
        title:        input.title,
        body:         input.body,
        published_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw Errors.internal(insertError.message);

    // Upload image if provided
    if (imageRaw) {
      const imageUri = await uploadImage(imageRaw, inserted.id);

      const { data: updated, error: updateError } = await supabase
        .from(TABLE)
        .update({ image_uri: imageUri })
        .eq('id', inserted.id)
        .select()
        .single();

      if (updateError) throw Errors.internal(updateError.message);
      return updated;
    }

    return inserted;
  },

  // PATCH — admin only
  async update(
    id:       string,
    input:    UpdateAnnouncementInput,
    imageRaw: string | undefined,
  ) {
    // Confirm exists
    await announcementsService.getById(id);

    const patch: Record<string, unknown> = { ...input };

    // Replace image if a new one was sent
    if (imageRaw) {
      const imageUri = await uploadImage(imageRaw, id);
      patch.image_uri = imageUri;
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw Errors.internal(error.message);
    return data;
  },

  // DELETE — admin only
  // Deletes the DB row AND removes the image folder from storage
  async remove(id: string) {
    // Confirm exists
    await announcementsService.getById(id);

    // Delete storage first — row still exists so we can reference the ID
    await deleteImage(id);

    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id);

    if (error) throw Errors.internal(error.message);
    return { deleted: true, id };
  },
};