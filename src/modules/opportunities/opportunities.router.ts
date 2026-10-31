import { Router }                  from 'express';
import { opportunitiesController } from './opportunities.controller';
import { requireAuth }             from '../../middleware/auth.middleware';
import { requireRole }             from '../../middleware/role.middleware';
import { imageUpload }             from './opportunities.image';

const router = Router();

router.use(requireAuth);

// ── Admin routes (mounted before /:id so "admin" is never read as an id) ──
const admin = Router();
admin.use(requireRole('admin'));

admin.get(  '/',             opportunitiesController.listAll);
admin.post( '/',             imageUpload, opportunitiesController.create);
admin.get(  '/:id',          opportunitiesController.getById);
admin.patch('/:id',          imageUpload, opportunitiesController.update);
admin.post( '/:id/publish',  opportunitiesController.transition('publish'));
admin.post( '/:id/close',    opportunitiesController.transition('close'));
admin.post( '/:id/archive',  opportunitiesController.transition('archive'));

router.use('/admin', admin);

// ── Member routes: open opportunities only ────────────────────────────────
router.get('/',    opportunitiesController.listPublished);
router.get('/:id', opportunitiesController.getPublished);

export default router;
