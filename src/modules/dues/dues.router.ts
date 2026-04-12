import { Router }         from 'express';
import { duesController } from './dues.controller';
import { requireAuth }    from '../../middleware/auth.middleware';

const router = Router();

// ── Stripe webhook — raw body, no auth ──────────────────────────────────
router.post('/webhook', duesController.webhook);
router.post('/verify/:code',duesController.verifyCode)
router.get('/my-code', duesController.getVerifyCode); 

// ── Protected routes ─────────────────────────────────────────────────────
router.use(requireAuth);

router.get( '/status',                duesController.getStatus);
router.get( '/history',               duesController.getHistory);
router.post('/create-payment-intent', duesController.createPaymentIntent);
router.post('/confirm',               duesController.confirmPayment);

export default router;