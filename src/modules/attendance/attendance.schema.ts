import { z } from 'zod';

// accuracy is the GPS accuracy the phone reports, in metres
export const CheckInSchema = z.object({
  meeting_id: z.uuid(),
  check_in_code: z.string().trim().toUpperCase().min(1).max(32),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().max(100000),
});

// No default year here — a default would be fixed at server start, so the
// service falls back to the current Paris year instead
export const HistoryQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

// No defaults on these fields, so a PATCH never resets what it didn't send
const MeetingFields = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  location_name: z.string().trim().max(200).nullable().optional(),
  meeting_date: z.iso.date(),
  starts_at: z.iso.datetime({ offset: true }).nullable().optional(),
  ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_m: z.number().int().min(25).max(2000),
});

export const CreateMeetingSchema = MeetingFields.extend({
  radius_m: MeetingFields.shape.radius_m.default(100),
  is_active: z.boolean().default(false),
});

// Activation goes through PATCH /meetings/:id/active; cancelled sets or clears cancelled_at
export const UpdateMeetingSchema = MeetingFields.partial().extend({
  cancelled: z.boolean().optional(),
});

export const SetMeetingActiveSchema = z.object({
  is_active: z.boolean(),
});

export const MEETING_STATUSES = ['upcoming', 'cancelled', 'completed'] as const;
export type MeetingStatus = typeof MEETING_STATUSES[number];

export const ATTENDANCE_STATUSES = ['attended', 'unavailable'] as const;

export const ListMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(MEETING_STATUSES).optional(),
});

export const MeetingIdSchema = z.object({
  id: z.uuid(),
});

export const RecordIdSchema = z.object({
  recordId: z.uuid(),
});

export const UserIdSchema = z.object({
  userId: z.uuid(),
});

export const RosterQuerySchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES).optional(),
});

export const ManualMarkSchema = z.object({
  user_id: z.uuid(),
});

// Year falls back to the current Paris year in the service; month is optional
export const ListRecordsQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  user_id: z.uuid().optional(),
});

// Month and year fall back to the current Paris month in the service
export const SummaryQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

export type CheckInInput = z.infer<typeof CheckInSchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export type CreateMeetingInput = z.infer<typeof CreateMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof UpdateMeetingSchema>;
export type SetMeetingActiveInput = z.infer<typeof SetMeetingActiveSchema>;
export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuerySchema>;
export type RosterQuery = z.infer<typeof RosterQuerySchema>;
export type ManualMarkInput = z.infer<typeof ManualMarkSchema>;
export type ListRecordsQuery = z.infer<typeof ListRecordsQuerySchema>;
export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;
