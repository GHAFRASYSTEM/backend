import { z } from 'zod';

// Multipart form fields always arrive as strings, so we validate the raw text
// against the contract's regex first, then convert to a number.
const amountSchema = z.string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a number with at most 2 decimal places.')
  .transform(Number)
  .refine((value) => value > 0, 'Amount must be greater than 0.')
  .refine((value) => value <= 9999999999.99, 'Amount cannot exceed 9999999999.99.');

// Compared against today's date in UTC.
const transactionDateSchema = z.string()
  .date('Transaction date must be a valid date (YYYY-MM-DD).')
  .refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    'Transaction date cannot be in the future.',
  );

// 1. Schema for creating a financial record
export const createRecordSchema = z.object({
  amount: amountSchema,
  category: z.enum(['income', 'expense'], {
    message: "Category must be either 'income' or 'expense'.",
  }),
  purpose: z.string().trim().min(1, 'Purpose is required.').max(500, 'Purpose cannot exceed 500 characters.'),
  counterparty: z.string().trim().min(1, 'Counterparty is required.').max(255, 'Counterparty cannot exceed 255 characters.'),
  transaction_date: transactionDateSchema,
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

// 3. Shared period filters (month / date range)
const periodFilterShape = {
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format.').optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
};

type PeriodQuery = { month?: string; date_from?: string; date_to?: string };

// Applied after each schema is built, so we never call .extend() on a refined schema.
function checkPeriod(query: PeriodQuery, context: z.RefinementCtx) {
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
}

export const recordIdSchema = z.uuid();

// 4. Schema for query filters, sorting, and pagination when listing records
export const listQuerySchema = z.object({
  ...periodFilterShape,
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
}).superRefine((query, context) => {
  checkPeriod(query, context);

  if (
    query.min_amount !== undefined &&
    query.max_amount !== undefined &&
    query.min_amount > query.max_amount
  ) {
    context.addIssue({
      code: 'custom',
      message: 'min_amount must be less than or equal to max_amount.',
      path: ['min_amount'],
    });
  }
});

// 5. Schema for the summary endpoint
export const summaryQuerySchema = z.object({
  ...periodFilterShape,
  months: z.coerce.number().int().min(1).max(24).default(6),
}).superRefine(checkPeriod);

// Export inferred types for use in controllers and services
export type CreateRecordDto = z.infer<typeof createRecordSchema>;
export type UpdateRecordDto = z.infer<typeof updateRecordSchema>;
export type ListQueryDto = z.infer<typeof listQuerySchema>;
export type SummaryQueryDto = z.infer<typeof summaryQuerySchema>;