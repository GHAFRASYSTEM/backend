import { z } from 'zod';

function decimalPlaces(value: number): number {
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const fractionalDigits = mantissa.split('.')[1]?.length ?? 0;
  return Math.max(0, fractionalDigits - Number(exponentText ?? 0));
}

const amountSchema = z.union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite, 'Amount must be a finite number.')
  .refine((value) => value > 0, 'Amount must be a number greater than 0.')
  .refine((value) => decimalPlaces(value) <= 2, 'Amount cannot have more than 2 decimal places.')
  .refine((value) => value <= 9999999999.99, 'Amount cannot exceed 9999999999.99.');

// 1. Schema for creating a financial record
export const createRecordSchema = z.object({
  amount: amountSchema,
  category: z.enum(['income', 'expense'], {
    message: "Category must be either 'income' or 'expense'.",
  }),
  purpose: z.string().trim().min(1, 'Purpose is required.').max(500, 'Purpose cannot exceed 500 characters.'),
  counterparty: z.string().trim().min(1, 'Counterparty is required.').max(255, 'Counterparty cannot exceed 255 characters.'),
  transaction_date: z.iso.date().optional(),
});

// 2. Schema for updating a financial record (all fields optional)
export const updateRecordSchema = createRecordSchema.partial().extend({
  document: z.boolean().optional(),
  remove_document: z.preprocess(
    (value) => value === 'true' ? true : value === 'false' ? false : value,
    z.boolean().optional(),
  ),
}).superRefine((record, context) => {
  if (record.document && record.remove_document === true) {
    context.addIssue({
      code: 'custom',
      message: 'A document cannot be uploaded while remove_document is true.',
      path: ['remove_document'],
    });
  }
});

// 3. Schema for query filters, sorting, and pagination when listing records
const periodFiltersSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format.').optional(),
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
}).superRefine((query, context) => {
  if (query.month && (query.date_from || query.date_to)) {
    context.addIssue({
      code: 'custom',
      message: 'month cannot be combined with date_from or date_to.',
      path: ['month'],
    });
  }

  if (query.date_from && query.date_to && query.date_from > query.date_to) {
    context.addIssue({
      code: 'custom',
      message: 'date_from must be on or before date_to.',
      path: ['date_from'],
    });
  }
});

export const recordIdSchema = z.uuid();

export const listQuerySchema = periodFiltersSchema.extend({
  category: z.enum(['income', 'expense']).optional(),
  search: z.string().optional(),
  min_amount: z.coerce.number().finite().optional(),
  max_amount: z.coerce.number().finite().optional(),
  has_document: z.enum(['true', 'false']).optional().transform((value) => (
    value === undefined ? undefined : value === 'true'
  )),
  sort_by: z.enum(['transaction_date', 'amount', 'created_at']).default('transaction_date'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const summaryQuerySchema = periodFiltersSchema.extend({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

// Export inferred types for use in controllers and services
export type CreateRecordDto = z.infer<typeof createRecordSchema>;
export type UpdateRecordDto = z.infer<typeof updateRecordSchema>;
export type ListQueryDto = z.infer<typeof listQuerySchema>;
export type SummaryQueryDto = z.infer<typeof summaryQuerySchema>;