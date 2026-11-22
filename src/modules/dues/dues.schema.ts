import { z } from 'zod';

export const CreatePaymentIntentSchema = z.object({
  type:   z.enum(['dues', 'donation']),
  amount: z.number().positive().optional(), // required for donations, ignored for dues
  // Dues only: how many months to cover, starting from the first unpaid month
  months: z.number().int().min(1).max(12).default(1),
});

export const ConfirmPaymentSchema = z.object({
  payment_intent_id: z.string().min(1),
  type:              z.enum(['dues', 'donation']),
});

export type CreatePaymentIntentInput = z.infer<typeof CreatePaymentIntentSchema>;
export type ConfirmPaymentInput      = z.infer<typeof ConfirmPaymentSchema>;