import { z } from 'zod';

const ChargeSchema = z.object({
  label:  z.string().min(1),
  amount: z.number().positive(),
});

export const CreateHousingSchema = z.object({
  title:       z.string().min(3).max(200),
  description: z.string().min(10),
  address:     z.string().min(3),
  city:        z.string().min(2),
  location:    z.string().default(''),
  type:        z.enum(['Studio', 'Apartment', 'Room', 'Colocation']),
  bedrooms:    z.coerce.number().int().min(0),
  bathrooms:   z.coerce.number().int().min(0),
  size:        z.coerce.number().min(0),
  price:       z.coerce.number().positive(),
  available:   z.coerce.boolean().default(true),
  notes:       z.string().default(''),
  charges:     z.array(ChargeSchema).default([]),
});

export const UpdateHousingSchema = CreateHousingSchema.partial();

export const ListHousingSchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(50).default(10),
  city:      z.string().optional(),
  type:      z.enum(['Studio', 'Apartment', 'Room', 'Colocation']).optional(),
  available: z.coerce.boolean().optional(),
  min_price: z.coerce.number().optional(),
  max_price: z.coerce.number().optional(),
  sort_by:   z.enum(['price', 'created_at', 'size']).default('created_at'),
  sort_order:z.enum(['asc', 'desc']).default('desc'),
});

export const RoomRequestSchema = z.object({
  message: z.string().max(500).default(''),
});

export const UpdateRequestStatusSchema = z.object({
  status: z.enum(['approved', 'rejected', 'withdrawn']),
});

export type CreateHousingInput       = z.infer<typeof CreateHousingSchema>;
export type UpdateHousingInput       = z.infer<typeof UpdateHousingSchema>;
export type ListHousingInput         = z.infer<typeof ListHousingSchema>;
export type RoomRequestInput         = z.infer<typeof RoomRequestSchema>;
export type UpdateRequestStatusInput = z.infer<typeof UpdateRequestStatusSchema>;