import { z } from 'zod';

export const AnnouncementCategory = z.enum([
  'news', 'event', 'housing', 'personal', 'update',
]);

export const CreateAnnouncementSchema = z.object({
  category: AnnouncementCategory,
  title:    z.string().min(3).max(200),
  body:     z.string().min(10),
  // image comes in as a base64 data URI or multipart — handled in controller
});

export const UpdateAnnouncementSchema = z.object({
  category: AnnouncementCategory.optional(),
  title:    z.string().min(3).max(200).optional(),
  body:     z.string().min(10).optional(),
  // image handled separately
});

export const PaginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const AnnouncementIdSchema = z.object({
  id: z.string().uuid(),
});

export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof UpdateAnnouncementSchema>;
export type PaginationInput         = z.infer<typeof PaginationSchema>;