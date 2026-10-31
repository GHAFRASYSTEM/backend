import { z } from 'zod';
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_STATUSES,
  APPLICATION_METHODS,
  type ApplicationMethod,
} from './opportunities.rules';

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

// No .default() here: Zod 4 still applies defaults inside .partial(), which
// would make a PATCH silently reset qualifications/skills to [].
const fields = {
  title:                    z.string().trim().min(3).max(200),
  organization:             z.string().trim().min(2).max(200),
  type:                     z.enum(OPPORTUNITY_TYPES),
  description:              z.string().trim().min(20).max(10_000),
  qualifications:           z.array(z.string().trim().min(1).max(300)).max(30),
  skills:                   z.array(z.string().trim().min(1).max(100)).max(50),
  location:                 z.string().trim().min(2).max(200),
  application_deadline:     z.iso.date('application_deadline must be YYYY-MM-DD').nullable(),
  application_method:       z.enum(APPLICATION_METHODS),
  application_url:          z.url({ protocol: /^https?$/ }).nullable().optional(),
  application_email:        z.email().nullable().optional(),
  application_instructions: optionalText(2000),
  contact_name:             optionalText(200),
  contact_email:            z.email().nullable().optional(),
  contact_phone:            z.string().trim().min(6).max(30).nullable().optional(),
  image_url:                z.url({ protocol: /^https?$/ }).nullable().optional(),
};

type ApplicationDetails = {
  application_method?:       ApplicationMethod;
  application_url?:          string | null;
  application_email?:        string | null;
  application_instructions?: string | null;
};

const REQUIRED_DETAIL: Record<ApplicationMethod, keyof ApplicationDetails> = {
  url:   'application_url',
  email: 'application_email',
  other: 'application_instructions',
};

// Mirrors opportunities_application_details_check in the migration.
export function missingApplicationDetail(input: ApplicationDetails): keyof ApplicationDetails | null {
  if (!input.application_method) return null;
  const field = REQUIRED_DETAIL[input.application_method];
  return input[field] ? null : field;
}

export const CreateOpportunitySchema = z
  .strictObject({
    ...fields,
    qualifications:       fields.qualifications.optional(),
    skills:               fields.skills.optional(),
    application_deadline: fields.application_deadline.optional(),
  })
  .superRefine((input, ctx) => {
    const field = missingApplicationDetail(input);
    if (field) {
      ctx.addIssue({
        code:    'custom',
        path:    [field],
        message: `${field} is required when application_method is "${input.application_method}"`,
      });
    }
  });
export type CreateOpportunityInput = z.infer<typeof CreateOpportunitySchema>;

// Status is deliberately absent: it only changes through publish/close/archive.
export const UpdateOpportunitySchema = z
  .strictObject(fields)
  .partial()
  .refine(input => Object.keys(input).length > 0, { message: 'At least one field is required' });
export type UpdateOpportunityInput = z.infer<typeof UpdateOpportunitySchema>;

const booleanString = z.enum(['true', 'false']).transform(v => v === 'true');

export const MemberListQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(50).default(20),
  type:     z.enum(OPPORTUNITY_TYPES).optional(),
  location: z.string().trim().min(1).max(100).optional(),
  search:   z.string().trim().min(1).max(100).optional(),
});
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;

export const ADMIN_SORT_FIELDS = ['created_at', 'updated_at', 'published_at', 'application_deadline', 'title'] as const;

export const AdminListQuerySchema = MemberListQuerySchema.extend({
  status:     z.enum(OPPORTUNITY_STATUSES).optional(),
  expired:    booleanString.optional(),
  sort_by:    z.enum(ADMIN_SORT_FIELDS).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});
export type AdminListQuery = z.infer<typeof AdminListQuerySchema>;

export const OpportunityIdSchema = z.object({
  id: z.uuid('id must be a valid UUID'),
});
