import { z } from 'zod';

export const CheckInSchema = z.object({
  // meeting_id, check_in_code, latitude, longitude, accuracy
});

// No default year here — a default would be fixed at server start, so the
// service falls back to the current Paris year instead
export const HistoryQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

export const CreateMeetingSchema = z.object({
  // title, description, meeting_date, starts_at, ends_at, latitude, longitude, radius_m, is_active
});

export const UpdateMeetingSchema = CreateMeetingSchema.partial();

export const SetMeetingActiveSchema = z.object({
  // is_active
});

export const MEETING_STATUSES = ['upcoming', 'cancelled', 'completed'] as const;
export type MeetingStatus = typeof MEETING_STATUSES[number];

export const ListMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(MEETING_STATUSES).optional(),
});

export const MeetingIdSchema = z.object({
  id: z.string().uuid(),
});

export const RosterQuerySchema = z.object({
  // status: attended | unavailable
});

export const ManualMarkSchema = z.object({
  // user_id
});

export const ListRecordsQuerySchema = z.object({
  // month, year, status, user_id
});

export const SummaryQuerySchema = z.object({
  // month, year
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
