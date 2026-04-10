import { supabase }  from '../../config/supabase';
import { Errors }    from '../../shared/errors';
import { notificationService } from '../notifications/notifications.service';
import type {
  CreateHousingInput, UpdateHousingInput,
  ListHousingInput, RoomRequestInput, UpdateRequestStatusInput,
} from './housing.schema';

// ── Image helpers ─────────────────────────────────────────────────────────

// Convert base64 data URL → upload to Supabase storage → return public URL
async function uploadImage(base64DataUrl: string, housingId: string): Promise<string> {
  // Expect: "data:image/jpeg;base64,/9j/4AAQ..."
  const matches = base64DataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) throw Errors.badRequest('Invalid image format — must be base64 data URL');

  const mimeType  = matches[1]; // e.g. image/jpeg
  const base64    = matches[2];
  const ext       = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const filename  = `${housingId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer    = Buffer.from(base64, 'base64');

  const { error } = await supabase.storage
    .from('housing')
    .upload(filename, buffer, {
      contentType:  mimeType,
      cacheControl: '3600',
      upsert:       false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('housing').getPublicUrl(filename);
  return data.publicUrl;
}

// Delete all images in the housing folder
async function deleteHousingImages(housingId: string): Promise<void> {
  const { data: files } = await supabase.storage
    .from('housing')
    .list(housingId);

  if (!files?.length) return;

  const paths = files.map(f => `${housingId}/${f.name}`);
  await supabase.storage.from('housing').remove(paths);
}

// Delete specific image by URL
async function deleteImageByUrl(url: string): Promise<void> {
  // Extract path from URL: .../storage/v1/object/public/housing/UUID/file.jpg
  const path = url.split('/housing/')[1];
  if (path) await supabase.storage.from('housing').remove([path]);
}

// ── Housing service ───────────────────────────────────────────────────────
export const housingService = {

  // ── List with filters + pagination ───────────────────────────────────────
  async list(input: ListHousingInput) {
    const { page, limit, city, type, available, min_price, max_price, sort_by, sort_order } = input;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('housing')
      .select(`
        id, title, description, address, city, location,
        type, bedrooms, bathrooms, size, price,
        available, images, charges, notes,
        author_id, created_at, updated_at
      `, { count: 'exact' });

    if (city)      query = query.ilike('city', `%${city}%`);
    if (type)      query = query.eq('type', type);
    if (available !== undefined) query = query.eq('available', available);
    if (min_price) query = query.gte('price', min_price);
    if (max_price) query = query.lte('price', max_price);

    query = query
      .order(sort_by, { ascending: sort_order === 'asc' })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      housing: data ?? [],
      total:   count ?? 0,
      page,
      limit,
      pages:   Math.ceil((count ?? 0) / limit),
    };
  },

  // ── Get one ───────────────────────────────────────────────────────────────
  async getOne(id: string) {
    const { data, error } = await supabase
      .from('housing')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw Errors.notFound('Housing');
    return data;
  },

  // ── Create — accepts base64 images, uploads to Supabase storage ──────────
  async create(authorId: string, input: CreateHousingInput, imageDataUrls: string[] = []) {
    // 1. Insert housing row first to get the ID (needed for storage folder)
    const { data: housing, error: insertError } = await supabase
      .from('housing')
      .insert({
        ...input,
        charges:   input.charges,
        author_id: authorId,
        images:    [], // placeholder
      })
      .select()
      .single();

    if (insertError) {
      console.error('[housing] create insert error:', insertError);
      throw insertError;
    }

    // 2. Upload images using the new housing ID as folder
    const imageUrls: string[] = [];
    for (const dataUrl of imageDataUrls) {
      try {
        const url = await uploadImage(dataUrl, housing.id);
        imageUrls.push(url);
      } catch (err) {
        console.error('[housing] image upload failed:', err);
        // Continue — partial upload is better than full failure
      }
    }

    // 3. Update housing row with real image URLs
    if (imageUrls.length > 0) {
      const { data: updated } = await supabase
        .from('housing')
        .update({ images: imageUrls })
        .eq('id', housing.id)
        .select()
        .single();
      return updated ?? housing;
    }

    return housing;
  },

  // ── Update ────────────────────────────────────────────────────────────────
  async update(
    id:            string,
    input:         UpdateHousingInput,
    newImageDataUrls:    string[] = [],  // new base64 images to add
    removedImageUrls:    string[] = [],  // existing URLs to remove
  ) {
    const { data: existing } = await supabase
      .from('housing')
      .select('id, images')
      .eq('id', id)
      .single();

    if (!existing) throw Errors.notFound('Housing');

    // Delete removed images from storage
    for (const url of removedImageUrls) {
      await deleteImageByUrl(url).catch(console.error);
    }

    // Upload new images
    const newUrls: string[] = [];
    for (const dataUrl of newImageDataUrls) {
      const url = await uploadImage(dataUrl, id).catch(e => {
        console.error('[housing] upload error:', e);
        return null;
      });
      if (url) newUrls.push(url);
    }

    // Merge: keep existing (minus removed) + add new
    const keptImages = (existing.images as string[]).filter(
      url => !removedImageUrls.includes(url)
    );
    const finalImages = [...keptImages, ...newUrls];

    const { data, error } = await supabase
      .from('housing')
      .update({ ...input, images: finalImages, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ── Delete — removes images from storage too ─────────────────────────────
  async delete(id: string) {
    const { data: existing } = await supabase
      .from('housing')
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) throw Errors.notFound('Housing');

    // Delete all images in the housing folder from Supabase storage
    await deleteHousingImages(id).catch(console.error);

    // Delete the row (room_requests cascade via FK)
    const { error } = await supabase
      .from('housing')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { deleted: true, id };
  },

  // ── Room request: user requests a room ───────────────────────────────────
  async requestRoom(userId: string, housingId: string, input: RoomRequestInput) {
    // Check housing exists and is available
    const { data: housing } = await supabase
      .from('housing')
      .select('id, title, available, author_id')
      .eq('id', housingId)
      .single();

    if (!housing)          throw Errors.notFound('Housing');
    if (!housing.available) throw Errors.badRequest('This accommodation is no longer available');

    // Check for existing request
    const { data: existing } = await supabase
      .from('room_requests')
      .select('id, status')
      .eq('housing_id', housingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing && existing.status === 'pending') {
      throw Errors.conflict('You already have a pending request for this accommodation');
    }

    // Insert or re-insert if previous was rejected/withdrawn
    const { data: request, error } = await supabase
      .from('room_requests')
      .upsert(
        {
          housing_id: housingId,
          user_id:    userId,
          message:    input.message,
          status:     'pending',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'housing_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    // Notify admin/author
    await notificationService.sendToUser(housing.author_id, {
      title: '🏠 New Room Request',
      body:  `Someone has requested "${housing.title}"`,
    }).catch(console.error);

    return request;
  },

  // ── Get all requests for a housing (admin) ────────────────────────────────
  async getRequestsForHousing(housingId: string) {
    const { data, error } = await supabase
      .from('room_requests')
      .select(`
        id, message, status, created_at, updated_at,
        housing:housing_id (
          id, title, city, location, type, price, images, address
        ),
        user:user_id (
          id, name, email, photo_url, ghana_phone, french_phone,
          region, occupation, member_since, is_verified
        )
      `)
      .eq('housing_id', housingId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  // ── Get all requests (admin — see all) ────────────────────────────────────
  async getAllRequests(status?: string) {
    let query = supabase
      .from('room_requests')
      .select(`
        id, message, status, created_at, updated_at,
        housing:housing_id (
          id, title, city, location, type, price, images, address
        ),
        user:user_id (
          id, name, email, photo_url, ghana_phone,
          region, occupation, is_verified
        )
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  // ── Get user's own requests ───────────────────────────────────────────────
  async getMyRequests(userId: string) {
    const { data, error } = await supabase
      .from('room_requests')
      .select(`
        id, message, status, created_at, updated_at,
        housing:housing_id (
          id, title, city, location, type, price, images, address
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  // ── Update request status (admin) ─────────────────────────────────────────
  async updateRequestStatus(requestId: string, input: UpdateRequestStatusInput) {
    const { data: req } = await supabase
      .from('room_requests')
      .select('id, user_id, housing_id, status')
      .eq('id', requestId)
      .single();

    if (!req) throw Errors.notFound('Room request');

    const { data, error } = await supabase
      .from('room_requests')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;

    // Notify the user of the decision
    const messages: Record<string, string> = {
      approved: '✅ Your room request has been approved!',
      rejected: 'Your room request was not successful this time.',
      withdrawn: 'Your room request has been withdrawn.',
    };

    await notificationService.sendToUser(req.user_id, {
      title: 'Room Request Update',
      body:  messages[input.status] ?? 'Your request status has changed.',
    }).catch(console.error);

    return data;
  },

  // ── Withdraw own request (user) ───────────────────────────────────────────
  async withdrawRequest(requestId: string, userId: string) {
    const { data: req } = await supabase
      .from('room_requests')
      .select('id, user_id, status')
      .eq('id', requestId)
      .single();

    if (!req)                  throw Errors.notFound('Room request');
    if (req.user_id !== userId) throw Errors.forbidden();
    if (req.status !== 'pending') throw Errors.badRequest('Only pending requests can be withdrawn');

    const { data, error } = await supabase
      .from('room_requests')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};