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
export const AppleSignInSchema = z.object({
  identity_token: z.string().min(1),   // Apple's JWT
  device_token:   z.string().optional(),
  platform:       z.enum(['ios', 'android']).optional(),
});

export const EmailSignInSchema = z.object({
  email:        z.string().email(),
  password:     z.string().min(8),
  device_token: z.string().optional(),
  platform:     z.enum(['ios', 'android']).optional(),
});

export const EmailSignUpSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
});

export type EmailSignInInput = z.infer<typeof EmailSignInSchema>;
export type EmailSignUpInput = z.infer<typeof EmailSignUpSchema>;
export type AppleSignInInput = z.infer<typeof AppleSignInSchema>;
export type GoogleCallbackInput    = z.infer<typeof GoogleCallbackSchema>;
export type AdminGoogleSignInInput = z.infer<typeof AdminGoogleSignInSchema>;
export type CompleteProfileInput   = z.infer<typeof CompleteProfileSchema>;
export type FcmTokenInput          = z.infer<typeof FcmTokenSchema>;