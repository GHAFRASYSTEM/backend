import { z } from 'zod';

export const GoogleCallbackSchema = z.object({
  access_token: z.string().min(1),
  device_token: z.string().optional(),
  platform:     z.enum(['ios', 'android']).optional(),
});

export const AdminGoogleSignInSchema = z.object({
  access_token: z.string().min(1),
});

export const CompleteProfileSchema = z.object({
  name:         z.string().min(2).max(100),
  gender:       z.enum(['male', 'female', 'prefer_not_to_say']),
  ghana_phone:  z.string().min(10).max(15),
  french_phone: z.string().optional(),
  city:         z.string().min(2).max(100),
  occupation:   z.string().min(2).max(100),
  photo_url:    z.string().url().optional(),
  // Region is NOT accepted from frontend — assigned by backend
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export const FcmTokenSchema = z.object({
  token:    z.string().min(1),
  platform: z.enum(['ios', 'android']),
});

export const DeleteFcmTokenSchema = z.object({
  token: z.string().min(1),
});

export type GoogleCallbackInput    = z.infer<typeof GoogleCallbackSchema>;
export type AdminGoogleSignInInput = z.infer<typeof AdminGoogleSignInSchema>;
export type CompleteProfileInput   = z.infer<typeof CompleteProfileSchema>;
export type FcmTokenInput          = z.infer<typeof FcmTokenSchema>;