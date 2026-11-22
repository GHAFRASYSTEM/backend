import { z } from 'zod';
import { CATEGORIES } from './notifications.service';

export const AudienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('users'), userIds: z.array(z.uuid()).min(1).max(5000) }),
  z.object({
    type:  z.literal('unpaid_dues'),
    month: z.number().int().min(1).max(12),
    year:  z.number().int().min(2020).max(2100),
  }),
  z.object({ type: z.literal('not_checked_in'), meetingId: z.uuid() }),
  z.object({ type: z.literal('not_practiced_today'), day: z.iso.date() }),
  z.object({ type: z.literal('city'), city: z.string().trim().min(2).max(100) }),
]);

export const SendNotificationSchema = z.object({
  category: z.enum(CATEGORIES).default('general'),
  title:    z.string().trim().min(2).max(120),
  body:     z.string().trim().min(2).max(1000),
  audience: AudienceSchema,
  channels: z.array(z.enum(['push', 'email'])).min(1).default(['push']),
  // Optional in-app destination, e.g. "/(tabs)/(community)/attendance"
  route:    z.string().trim().max(200).optional(),
});

export const PreviewAudienceSchema = z.object({ audience: AudienceSchema });

export const PageSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const MarkReadSchema = z.object({
  ids: z.union([z.literal('all'), z.array(z.uuid()).min(1).max(200)]),
});

export const PreferencesSchema = z.object(
  Object.fromEntries([...CATEGORIES, 'email_enabled'].map(k => [k, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>,
).strict();

export type SendNotificationInput = z.infer<typeof SendNotificationSchema>;
