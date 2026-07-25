import { Router }           from 'express';
import { pickupController } from './pickup.controller';
import { requireAuth }      from '../../middleware/auth.middleware';
import { requireRole }      from '../../middleware/role.middleware';

const router = Router();

// Every pickup route requires a signed-in user
router.use(requireAuth);

// ── Member routes ─────────────────────────────────────────────────────────
router.post(  '/upload-url', pickupController.getUploadUrl);
router.post(  '/',           pickupController.create);
router.get(   '/me',         pickupController.getMine);
router.patch( '/me',         pickupController.updateMine);
router.delete('/me',         pickupController.cancelMine);

// ── Admin routes ───────────────────────────────────────────────────────────
router.get(   '/',              requireRole('admin'), pickupController.list);
router.patch( '/:id/status',    requireRole('admin'), pickupController.updateStatus);

export default router;