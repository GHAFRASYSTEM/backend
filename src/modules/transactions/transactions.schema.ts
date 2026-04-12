import { z } from 'zod';

export const CreatePaymentSchema = z.object({
  month:    z.number().min(1).max(12),
  year:     z.number().min(2020),
  amount:   z.number().positive(),
  currency: z.string().default('EUR'),
  method:   z.enum(['card']),
  type:     z.enum(['dues', 'donation']),
  label:    z.string().optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;