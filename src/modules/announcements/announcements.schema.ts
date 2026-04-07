// announcements.schema.ts
import { z } from 'zod';

export const AnnouncementCategory = z.enum([
  'news', 'event', 'housing', 'personal', 'update',
]);

export const CreateAnnouncementSchema = z.object({
  category:  AnnouncementCategory,
  title:     z.string().min(3).max(200),
  summary:   z.string().min(10).max(500),
  body:      z.string().min(10),
  image_uri: z.string().url().optional().nullable(),
});

export const UpdateAnnouncementSchema = CreateAnnouncementSchema.partial();

export const AnnouncementIdSchema = z.object({
  id: z.string().uuid(),
});

export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof UpdateAnnouncementSchema>;