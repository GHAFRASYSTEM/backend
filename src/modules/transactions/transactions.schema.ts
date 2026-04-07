import { z } from 'zod';

export const CreateDuesPaymentSchema = z.object({
  month:    z.number().min(1).max(12),
  year:     z.number().min(2020),
  amount:   z.number().positive(),
  currency: z.string().default('EUR'),
  method:   z.enum(['card', 'momo']),
});

export type CreateDuesPaymentInput = z.infer<typeof CreateDuesPaymentSchema>;