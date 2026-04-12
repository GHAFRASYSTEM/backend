import { Router }                  from 'express';
import { transactionsController }  from './transactions.controller';
import { requireAuth }             from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

// GET /transactions?type=dues|donation&month=&year=
router.get('/',      transactionsController.getMyPayments);

// Admin only: GET /transactions/all?type=&month=&year=
router.get('/all',   transactionsController.getAllPayments);

// GET /transactions/:id
router.get('/:id',   transactionsController.getPaymentById);

export default router;