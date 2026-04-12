import type { Request, Response, NextFunction } from 'express';
import { transactionsService } from './transactions.service';
import { ok }                  from '../../shared/response';
import { Errors }              from '../../shared/errors';

export const transactionsController = {

  // GET /transactions?type=dues|donation
  async getMyPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, month, year } = req.query;

      const payments = await transactionsService.getUserPayments(req.user!.id, {
        type:  type  as 'dues' | 'donation' | undefined,
        month: month ? Number(month) : undefined,
        year:  year  ? Number(year)  : undefined,
      });

      return ok(res, payments);
    } catch (err) {
      next(err);
    }
  },

  // GET /transactions/:id
  async getPaymentById(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const payment = await transactionsService.getPaymentById(
        req.user!.id,
        req.params.id,
      );
      return ok(res, payment);
    } catch (err) {
      next(err);
    }
  },

  // Admin-only: GET /transactions/all
  async getAllPayments(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.user!.role !== 'admin') throw Errors.forbidden();

      const { type, month, year } = req.query;

      const payments = await transactionsService.getAllPayments({
        type:  type  as 'dues' | 'donation' | undefined,
        month: month ? Number(month) : undefined,
        year:  year  ? Number(year)  : undefined,
      });

      return ok(res, payments);
    } catch (err) {
      next(err);
    }
  },
};