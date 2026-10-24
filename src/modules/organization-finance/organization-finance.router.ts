import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { OrganizationFinanceController as Ctrl } from './organization-finance.controller';

// Keep uploaded receipts in memory (max 5MB) so the service can send them to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

// Every route below requires a logged-in admin
router.use(requireAuth);
router.use(requireRole('admin'));

// /records -> list all, or create one (with an optional receipt file named "document")
router.route('/records')
  .get(Ctrl.list)
  .post(upload.single('document'), Ctrl.create);

// /records/:id -> get one, or delete one
router.route('/records/:id')
  .get(Ctrl.getById)
  .delete(Ctrl.remove);

export { router as organizationFinanceRouter };