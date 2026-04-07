import { Router } from 'express';
import { transactionsController } from './transactions.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);


// Get my payments
router.get('/dues', transactionsController.getMyDuesPayments);

// Admin only: get all payments with optional filters (month, year)
router.get('/dues/all', transactionsController.getAllDuesPayments);

// Get payment by ID (only if it belongs to the user or user is admin)
router.get('/dues/:id', transactionsController.getDuesPaymentById);

export default router;