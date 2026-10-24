import { Request, Response, NextFunction } from 'express';
import { OrganizationFinanceService } from './organization-finance.service';
import {
  createRecordSchema,
  listQuerySchema,
  recordIdSchema,
  summaryQuerySchema,
  updateRecordSchema,
} from './organization-finance.schema';
import { ok } from '../../shared/response';

export class OrganizationFinanceController {
  /**
   * POST /organization-finance/records
   */
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedData = createRecordSchema.parse(req.body);
      const userId = req.user!.id;
      const file = req.file;

      const record = await OrganizationFinanceService.createRecord(validatedData, file, userId);

      ok(res, record, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /organization-finance/records
   */
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedQuery = listQuerySchema.parse(req.query);
      const result = await OrganizationFinanceService.listRecords(validatedQuery);

      ok(res, result.data, 200, {
        meta: result.meta,
        period_totals: result.period_totals,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /organization-finance/summary
   */
  static async summary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = summaryQuerySchema.parse(req.query);
      const result = await OrganizationFinanceService.getSummary(query);
      ok(res, {
        currency: process.env.ORG_CURRENCY || 'EUR',
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /organization-finance/records/:id
   */
  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = recordIdSchema.parse(req.params.id);
      const record = await OrganizationFinanceService.getRecordById(id);

      ok(res, record);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /organization-finance/records/:id
   */
  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = recordIdSchema.parse(req.params.id);
      const input = updateRecordSchema.parse({
        ...req.body,
        ...(req.file ? { document: true } : {}),
      });
      const { document: _hasDocument, ...updates } = input;

      const record = await OrganizationFinanceService.updateRecord(
        id,
        updates,
        req.file,
      );
      ok(res, record);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /organization-finance/records/:id
   */
  static async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = recordIdSchema.parse(req.params.id);
      await OrganizationFinanceService.deleteRecord(id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}