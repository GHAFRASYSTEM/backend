import { z } from 'zod';

export const CreatePaymentIntentSchema = z.object({
  method: z.enum(['card', 'momo']),
});

export const ConfirmPaymentSchema = z.object({
  payment_intent_id: z.string().min(1),
  method:            z.enum(['card', 'momo']),
});

export type CreatePaymentIntentInput = z.infer<typeof CreatePaymentIntentSchema>;
export type ConfirmPaymentInput      = z.infer<typeof ConfirmPaymentSchema>;