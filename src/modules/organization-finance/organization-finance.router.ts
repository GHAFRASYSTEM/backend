import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { extname } from 'path';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { AppError, Errors } from '../../shared/errors';
import { OrganizationFinanceController as Ctrl } from './organization-finance.controller';

// Keep uploaded receipts in memory (max 5MB) so the service can send them to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    if (['.pdf', '.jpg', '.jpeg', '.png'].includes(extension)) {
      callback(null, true);
    } else {
      callback(Errors.unsupportedMediaType());
    }
  },
});

const uploadReceipt = (req: Request, res: Response, next: NextFunction) => {
  upload.single('document')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(Errors.payloadTooLarge());
      }
      return next(Errors.badRequest(error.message));
    }
    if (error instanceof AppError) return next(error);
    if (error) return next(error);
    next();
  });
};

const router = Router();

// Every route below requires a logged-in admin
router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/summary', Ctrl.summary);

// /records -> list all, or create one (with an optional receipt file named "document")
router.route('/records')
  .get(Ctrl.list)
  .post(uploadReceipt, Ctrl.create);

// /records/:id -> get, update, or delete one
router.route('/records/:id')
  .get(Ctrl.getById)
  .patch(uploadReceipt, Ctrl.update)
  .delete(Ctrl.remove);

export { router as organizationFinanceRouter };