// announcements.service.ts
import { Errors } from '../../shared/errors';
import { supabase } from '../../config/supabase';

import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcements.schema';

const TABLE = 'announcements';

export async function getAllAnnouncements() {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      id,
      category,
      title,
      summary,
      body,
      image_uri,
      published_at,
      updated_at,
      profiles:created_by ( name )
    `)
    .order('published_at', { ascending: false });

  if (error) throw Errors.internal(error.message);

  // Flatten: expose poster's name as `author` — client never sees created_by
  return data.map(row => ({
    id:           row.id,
    category:     row.category,
    title:        row.title,
    summary:      row.summary,
    body:         row.body,
    image_uri:    row.image_uri,
    published_at: row.published_at,
    updated_at:   row.updated_at,
    author:       (row.profiles as any)?.name ?? 'GHAFRA Admin',
  }));
}

export async function getAnnouncementById(id: string) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      id,
      category,
      title,
      summary,
      body,
      image_uri,
      published_at,
      updated_at,
      profiles:created_by ( name )
    `)
    .eq('id', id)
    .single();

  if (error || !data) throw Errors.notFound('Announcement not found');

  return {
    id:           data.id,
    category:     data.category,
    title:        data.title,
    summary:      data.summary,
    body:         data.body,
    image_uri:    data.image_uri,
    published_at: data.published_at,
    updated_at:   data.updated_at,
    author:       (data.profiles as any)?.name ?? 'GHAFRA Admin',
  };
}

export async function createAnnouncement(
  input:   CreateAnnouncementInput,
  adminId: string,
) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      category:     input.category,
      title:        input.title,
      summary:      input.summary,
      body:         input.body,
      image_uri:    input.image_uri ?? null,
      // author is derived from the admin's profile — not stored separately
      created_by:   adminId,
      published_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw Errors.internal(error.message);
  return data;
}

export async function updateAnnouncement(
  id:    string,
  input: UpdateAnnouncementInput,
) {
  await getAnnouncementById(id); // 404 if missing

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw Errors.internal(error.message);
  return data;
}

export async function deleteAnnouncement(id: string) {
  await getAnnouncementById(id); // 404 if missing

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id);

  if (error) throw Errors.internal(error.message);
  return { deleted: true, id };
}