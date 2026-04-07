import { Router }          from 'express';
import { duesController }  from './dues.controller';
import { requireAuth }     from '../../middleware/auth.middleware';

const router = Router();

// ── Stripe webhook — raw body, no auth ────────────────────────────────────
// MUST be before express.json() — needs raw buffer
router.post(
  '/webhook',
  duesController.webhook,
);

// ── Protected routes ──────────────────────────────────────────────────────
router.use(requireAuth);

router.get( '/status',                 duesController.getStatus);
router.get( '/history',                duesController.getHistory);
router.post('/create-payment-intent',  duesController.createPaymentIntent);
router.post('/confirm',                duesController.confirmPayment);

export default router;