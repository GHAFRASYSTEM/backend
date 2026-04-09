import { z } from 'zod';

export const ListMembersSchema = z.object({
  // Pagination
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),

  // Filters
  search:       z.string().optional(),           // name or email
  region:       z.enum(['Accra', 'Kumasi', 'Tamale', 'Sunyani']).optional(),
  gender:       z.enum(['male', 'female', 'prefer_not_to_say']).optional(),
  role:         z.enum(['member', 'admin', 'moderator']).optional(),
  member_type:  z.enum(['full', 'associate', 'honorary']).optional(),
  is_verified:  z.coerce.boolean().optional(),
  is_complete:  z.coerce.boolean().optional(),

  // Date range filters
  member_since_from: z.string().optional(),      // ISO date e.g. 2025-01-01
  member_since_to:   z.string().optional(),
  created_from:      z.string().optional(),
  created_to:        z.string().optional(),

  // Sorting
  sort_by:    z.enum([
    'name', 'email', 'created_at', 'member_since',
    'region', 'is_verified', 'is_complete',
  ]).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export const UpdateMemberSchema = z.object({
  name:         z.string().min(2).max(100).optional(),
  gender:       z.enum(['male', 'female', 'prefer_not_to_say']).optional(),
  ghana_phone:  z.string().min(10).max(15).optional(),
  french_phone: z.string().optional().nullable(),
  city:         z.string().min(2).max(100).optional(),
  occupation:   z.string().min(2).max(100).optional(),
  region:       z.enum(['Accra', 'Kumasi', 'Tamale', 'Sunyani']).optional(),
  role:         z.enum(['member', 'admin', 'moderator']).optional(),
  member_type:  z.enum(['full', 'associate', 'honorary']).optional(),
  is_verified:  z.boolean().optional(),
  is_complete:  z.boolean().optional(),
  member_since: z.string().optional(),           // ISO date string
});

export const ToggleVerifySchema = z.object({
  is_verified: z.boolean(),
});

export type ListMembersInput  = z.infer<typeof ListMembersSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type ToggleVerifyInput = z.infer<typeof ToggleVerifySchema>;