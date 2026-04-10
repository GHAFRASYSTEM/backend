import { Router }            from 'express';
import { housingController } from './housing.controller';
import { requireAuth }       from '../../middleware/auth.middleware';
import { requireRole }       from '../../middleware/role.middleware';

const router = Router();

router.use(requireAuth);

// ── Request routes (specific paths BEFORE /:id) ───────────────────────────
router.get( '/requests/all',   requireRole('admin'), housingController.getAllRequests);
router.get( '/requests/mine',                        housingController.getMyRequests);
router.patch('/requests/:requestId/status',   requireRole('admin'), housingController.updateRequestStatus);
router.patch('/requests/:requestId/withdraw',         housingController.withdrawRequest);

// ── Housing CRUD ──────────────────────────────────────────────────────────
router.get( '/',    housingController.list);
router.get( '/:id', housingController.getOne);
router.post('/',    requireRole('admin'), housingController.create);
router.patch('/:id', requireRole('admin'), housingController.update);
router.delete('/:id', requireRole('admin'), housingController.remove);

// ── Room requests ─────────────────────────────────────────────────────────
router.post('/:id/request',   housingController.requestRoom);
router.get( '/:id/requests',  requireRole('admin'), housingController.getRequestsForHousing);

export default router;