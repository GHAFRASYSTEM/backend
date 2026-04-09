import { Router }              from 'express';
import { membersController }   from './members.controller';
import { requireAuth }         from '../../middleware/auth.middleware';
import { requireRole }         from '../../middleware/role.middleware';

const router = Router();

// All members routes require auth + admin role
router.use(requireAuth);
router.use(requireRole('admin'));

// Stats
router.get('/stats', membersController.stats);

// List + single
router.get('/',    membersController.list);
router.get('/:id', membersController.getOne);

// Update
router.patch('/:id',        membersController.update);
router.patch('/:id/verify', membersController.toggleVerify);

// Delete
router.delete('/:id', membersController.remove);

export default router;