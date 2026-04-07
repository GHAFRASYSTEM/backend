// announcements.router.ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as Controller from './announcements.controller';


const router = Router();

// Any authenticated member can read
router.get('/',    requireAuth, Controller.list);
router.get('/:id', requireAuth, Controller.getOne);

// Admins only
router.post(  '/',    requireAuth, requireRole('admin'), Controller.create);
router.patch( '/:id', requireAuth, requireRole('admin'), Controller.update);
router.delete('/:id', requireAuth, requireRole('admin'), Controller.remove);

export default router;