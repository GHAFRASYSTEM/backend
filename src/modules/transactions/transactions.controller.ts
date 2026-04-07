import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { transactionsService } from './transactions.service';
import { ok, created } from '../../shared/response';
import { Errors } from '../../shared/errors';

export const transactionsController = {


  // GET /transactions/dues
  async getMyDuesPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const payments = await transactionsService.getUserPayments(req.user!.id);
      return ok(res, payments);
    } catch (err) {
      next(err);
    }
  },

  // GET /transactions/dues/:id
  async getDuesPaymentById(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const payment = await transactionsService.getPaymentById(
        req.user!.id,
        req.params.id
      );

      return ok(res, payment);
    } catch (err) {
      next(err);
    }
  },

  // Admin-only: GET /transactions/dues/all
    async getAllDuesPayments(req: Request, res: Response, next: NextFunction) {
    try {
      // 🔐 Only admins
      if (req.user!.role !== 'admin') {
        throw Errors.forbidden();
      }

      const { month, year } = req.query;

      const payments = await transactionsService.getAllPayments({
        month: month ? Number(month) : undefined,
        year:  year  ? Number(year)  : undefined,
      });

      return ok(res, payments);
    } catch (err) {
      next(err);
    }
  },

};