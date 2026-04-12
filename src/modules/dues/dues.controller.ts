import type { Request, Response, NextFunction } from 'express';
import { ZodError }    from 'zod';
import { duesService } from './dues.service';
import {
  CreatePaymentIntentSchema,
  ConfirmPaymentSchema,
} from './dues.schema';
import { ok, created } from '../../shared/response';

export const duesController = {

  // GET /dues/status
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await duesService.getStatus(req.user!.id);
      return ok(res, status);
    } catch (err) { next(err); }
  },

  // GET /dues/history
  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const history = await duesService.getHistory(req.user!.id);
      return ok(res, history);
    } catch (err) { next(err); }
  },

  // POST /dues/create-payment-intent
  async createPaymentIntent(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, amount } = CreatePaymentIntentSchema.parse(req.body);

      // Convert euros → cents for donations
      const amountCents = amount ? Math.round(amount * 100) : undefined;

      const result = await duesService.createPaymentIntent(
        req.user!.id,
        type,
        amountCents,
      );
      return created(res, result);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(422).json({
          success: false,
          error: {
            message: 'Validation failed',
            code:    'VALIDATION_ERROR',
            issues:  err.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
          },
        });
      }
      next(err);
    }
  },

  // POST /dues/confirm
  async confirmPayment(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('📥 /dues/confirm body:', JSON.stringify(req.body, null, 2));
      const { payment_intent_id, type } = ConfirmPaymentSchema.parse(req.body);
      const result = await duesService.confirmPayment(
        req.user!.id,
        payment_intent_id,
        type,
      );
      return ok(res, result);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(422).json({
          success: false,
          error: {
            message: 'Validation failed',
            code:    'VALIDATION_ERROR',
            issues:  err.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
          },
        });
      }
      next(err);
    }
  },

  // POST /dues/webhook  (no auth — Stripe calls this)
  async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      const sig    = req.headers['stripe-signature'] as string;
      const result = await duesService.handleWebhook(req.body as Buffer, sig);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // verify user's code
  async verifyCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.params;
    const result   = await duesService.verifyCode(code);
    return ok(res, result);
  } catch (err) { next(err); }
},

async getVerifyCode(req: Request, res: Response, next: NextFunction) {
  try {
    const code = await duesService.getVerifyCode(req.user!.id);
    return ok(res, { code }); // null if dues not paid
  } catch (err) { next(err); }
},
};