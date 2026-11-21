-- Optional cover image for a job or internship.
-- Uploads go to the public opportunity-images bucket and image_url stores
-- that public URL. A pasted external URL is stored in the same column as-is.

alter table public.opportunities
  add column image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'opportunity-images',
  'opportunity-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "opportunity images are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'opportunity-images');
