import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { authService } from './auth.service';
import {
  GoogleCallbackSchema,
  AdminGoogleSignInSchema,
  CompleteProfileSchema,
  RefreshTokenSchema,
  FcmTokenSchema, 
  AppleSignInSchema,
  EmailSignInSchema
} from './auth.schema';
import { ok, created } from '../../shared/response';

// ── Shared Zod error handler to avoid repetition ──────────────────────────────
function handleZodError(err: unknown, path: string, res: Response): boolean {
  if (err instanceof ZodError) {
    console.error(`❌ ${path} validation:`, err.issues);
    res.status(422).json({
      success: false,
      error: {
        message: 'Validation failed',
        code:    'VALIDATION_ERROR',
        issues:  err.issues.map(i => ({
          field:   i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return true;
  }
  return false;
}

export const authController = {

  // POST /auth/google — member sign-in
  async googleSignIn(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = GoogleCallbackSchema.parse(req.body);
      const result = await authService.handleGoogleSignIn(input);
      return ok(res, {
        user:                result.user,
        profile:             result.profile,
        is_new_member:       result.isNewMember,
        is_profile_complete: result.isProfileComplete,
        next_step:           result.isProfileComplete ? 'home' : 'complete_profile',
      });
    } catch (err) {
      if (handleZodError(err, '/auth/google', res)) return;
      next(err);
    }
  },

  // POST /auth/admin/google — admin sign-in
  async adminSignIn(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = AdminGoogleSignInSchema.parse(req.body);
      const result = await authService.handleAdminSignIn(input);
      return ok(res, {
        user:    result.user,
        profile: result.profile,
        role:    result.role,
      });
    } catch (err) {
      if (handleZodError(err, '/auth/admin/google', res)) return;
      next(err);
    }
  },

  // POST /auth/apple — member Apple sign-in
async appleSignIn(req: Request, res: Response, next: NextFunction) {
  try {
    const input  = AppleSignInSchema.parse(req.body);
    const result = await authService.handleAppleSignIn(input);
    return ok(res, {
      user:                result.user,
      profile:             result.profile,
      is_new_member:       result.isNewMember,
      is_profile_complete: result.isProfileComplete,
      next_step:           result.isProfileComplete ? 'home' : 'complete_profile',
      // Return session so client can call supabase.auth.setSession()
      session: {
        access_token:  result.session.access_token,
        refresh_token: result.session.refresh_token,
      },
    });
  } catch (err) {
    if (handleZodError(err, '/auth/apple', res)) return;
    next(err);
  }
},

// auth.controller.ts — add inside authController

async emailSignIn(req: Request, res: Response, next: NextFunction) {
  try {
    const input  = EmailSignInSchema.parse(req.body);
    const result = await authService.handleEmailSignIn(input);
    return ok(res, {
      user:                result.user,
      profile:             result.profile,
      is_new_member:       result.isNewMember,
      is_profile_complete: result.isProfileComplete,
      next_step:           result.isProfileComplete ? 'home' : 'complete_profile',
      session: result.session
        ? {
            access_token:  result.session.access_token,
            refresh_token: result.session.refresh_token,
          }
        : null,
    });
  } catch (err) {
    if (handleZodError(err, '/auth/email', res)) return;
    next(err);
  }
},

  // POST /auth/complete-profile
  async completeProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = CompleteProfileSchema.parse(req.body);
      const profile = await authService.completeProfile(req.user!.id, input);
      return created(res, profile);
    } catch (err) {
      if (handleZodError(err, '/auth/complete-profile', res)) return;
      next(err);
    }
  },

  // POST /auth/refresh
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refresh_token } = RefreshTokenSchema.parse(req.body);
      const session = await authService.refreshSession(refresh_token);
      return ok(res, session);
    } catch (err) {
      if (handleZodError(err, '/auth/refresh', res)) return;
      next(err);
    }
  },

  // POST /auth/signout
  async signOut(req: Request, res: Response, next: NextFunction) {
    try {
      const fcmToken = req.body?.fcm_token as string | undefined;
      await authService.signOut(req.user!.id, fcmToken);
      return ok(res, { message: 'Signed out successfully' });
    } catch (err) {
      next(err);
    }
  },

  // GET /auth/me
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await authService.getProfile(req.user!.id);
      return ok(res, profile);
    } catch (err) {
      next(err);
    }
  },

  // POST /auth/fcm-token
  async saveFcmToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, platform } = FcmTokenSchema.parse(req.body);
      await authService.saveFcmToken(req.user!.id, token, platform);
      return ok(res, { message: 'Token saved' });
    } catch (err) {
      if (handleZodError(err, '/auth/fcm-token', res)) return;
      next(err);
    }
  },

  // DELETE /auth/fcm-token/:token
  async deleteFcmToken(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = req.params.token;
      const token = raw
        ? decodeURIComponent(Array.isArray(raw) ? raw[0] : raw)
        : undefined;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: { message: 'Token is required', code: 'BAD_REQUEST' },
        });
      }

      await authService.deleteFcmToken(req.user!.id, token);
      return ok(res, { message: 'Token removed' });
    } catch (err) {
      next(err);
    }
  },
};