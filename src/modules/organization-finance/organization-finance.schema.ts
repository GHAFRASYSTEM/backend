import { z } from 'zod';

// Helper for decimal/amount validation (must be > 0, max 2 decimal places)
const amountSchema = z.union([z.number(), z.string()]).transform((val) => Number(val)).refine((val) => !isNaN(val) && val > 0, {
  message: 'Amount must be a number greater than 0.',
});

// 1. Schema for creating a financial record
export const createRecordSchema = z.object({
  amount: amountSchema,
  category: z.enum(['income', 'expense'], {
    message: "Category must be either 'income' or 'expense'.",
  }),
  purpose: z.string().trim().min(1, 'Purpose is required.').max(500, 'Purpose cannot exceed 500 characters.'),
  counterparty: z.string().trim().min(1, 'Counterparty is required.').max(255, 'Counterparty cannot exceed 255 characters.'),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Transaction date must be in YYYY-MM-DD format.').optional(),
});

// 2. Schema for updating a financial record (all fields optional)
export const updateRecordSchema = createRecordSchema.partial().extend({
  remove_document: z.boolean().optional(),
});

// 3. Schema for query filters, sorting, and pagination when listing records
export const listQuerySchema = z.object({
  category: z.enum(['income', 'expense']).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format.').optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date from must be in YYYY-MM-DD format.').optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date to must be in YYYY-MM-DD format.').optional(),
  search: z.string().optional(),
  min_amount: z.string().optional().transform((val) => (val ? Number(val) : undefined)),
  max_amount: z.string().optional().transform((val) => (val ? Number(val) : undefined)),
  has_document: z.string().optional().transform((val) => val === 'true'),
  sort_by: z.enum(['transaction_date', 'amount', 'created_at']).default('transaction_date'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  page: z.string().optional().default('1').transform((val) => Math.max(1, parseInt(val, 10))),
  limit: z.string().optional().default('20').transform((val) => Math.min(100, Math.max(1, parseInt(val, 10)))),
});

// Export inferred types for use in controllers and services
export type CreateRecordDto = z.infer<typeof createRecordSchema>;
export type UpdateRecordDto = z.infer<typeof updateRecordSchema>;
export type ListQueryDto = z.infer<typeof listQuerySchema>;