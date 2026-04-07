import { Router }         from 'express';
import { authController } from './auth.controller';
import { requireAuth }    from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/google',        authController.googleSignIn);
router.post('/refresh',       authController.refresh);

// Admin Google sign-in — public because JWT is not yet attached to req.user
// Role enforcement happens inside authService.handleAdminSignIn
router.post('/admin/google',  authController.adminSignIn);

// ── Protected — any authenticated user ───────────────────────────────────────
router.use(requireAuth);

router.get(   '/me',                   authController.me);
router.post(  '/complete-profile',     authController.completeProfile);
router.post(  '/signout',              authController.signOut);
router.post(  '/fcm-token',            authController.saveFcmToken);
router.delete('/fcm-token/:token',     authController.deleteFcmToken);

// ── Admin only — requires valid JWT + admin role ──────────────────────────────
router.get(
  '/admin/me',
  requireRole('admin'),
  authController.me,
);

export default router;