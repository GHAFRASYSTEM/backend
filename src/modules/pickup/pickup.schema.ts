import { z } from 'zod';

// ── Shared enums ───────────────────────────────────────────────────────────
export const GARES = ['Lille Flandres', 'Lille Europe'] as const;
export const PICKUP_STATUSES = ['pending', 'assigned', 'completed', 'cancelled'] as const;

// ── Create pickup request ─────────────────────────────────────────────────
// photo_url / ticket_photo_url are Supabase Storage PATHS (e.g.
// "<user_id>/photo.jpg"), not raw file bytes. The client uploads the file to
// storage first (via a signed URL from /pickup/upload-url) and then submits
// the resulting path here. This keeps the JSON payload tiny and upload speed
// independent of your API's request size limits.
export const CreatePickupRequestSchema = z.object({
  phone:            z.string().trim().min(6, 'Phone number is required').max(20),
  arrival_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'arrival_date must be YYYY-MM-DD'),
  arrival_time:     z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'arrival_time must be HH:mm'),
  train_number:     z.string().trim().min(1, 'Train number is required').max(100),
  gare:             z.enum(GARES),
  expected_luggage: z.string().trim().max(200).optional(),
  house_address:    z.string().trim().min(5, 'House address is required').max(500),
  photo_url:        z.string().trim().min(1).optional(),
  ticket_photo_url: z.string().trim().min(1).optional(),
});
export type CreatePickupRequestInput = z.infer<typeof CreatePickupRequestSchema>;

// ── Update pickup request (only while status = 'pending') ────────────────
export const UpdatePickupRequestSchema = CreatePickupRequestSchema.partial();
export type UpdatePickupRequestInput = z.infer<typeof UpdatePickupRequestSchema>;

// ── Request a signed upload URL for a photo ───────────────────────────────
export const UploadUrlRequestSchema = z.object({
  kind: z.enum(['photo', 'ticket']),
  // Original filename, used only to preserve the extension
  filename: z.string().trim().min(1).max(255),
});
export type UploadUrlRequestInput = z.infer<typeof UploadUrlRequestSchema>;

// ── Admin: update status / assignment ─────────────────────────────────────
export const AdminUpdateStatusSchema = z.object({
  status:      z.enum(PICKUP_STATUSES),
  assigned_to: z.string().uuid().nullable().optional(),
  admin_notes: z.string().trim().max(1000).nullable().optional(),
});
export type AdminUpdateStatusInput = z.infer<typeof AdminUpdateStatusSchema>;

// ── Admin: list / filter query params ─────────────────────────────────────
export const ListPickupRequestsQuerySchema = z.object({
  status: z.enum(PICKUP_STATUSES).optional(),
  gare:   z.enum(GARES).optional(),
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ListPickupRequestsQuery = z.infer<typeof ListPickupRequestsQuerySchema>;