import { Request, Response, NextFunction } from 'express';
import { OrganizationFinanceService } from './organization-finance.service';
import { createRecordSchema, listQuerySchema } from './organization-finance.schema';

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

      res.status(201).json({
        success: true,
        data: record,
      });
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

      res.status(200).json({
        success: true,
        data: result.data,
        meta: result.meta,
        period_totals: result.period_totals,
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
      const id = req.params.id as string;
      const record = await OrganizationFinanceService.getRecordById(id);

      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /organization-finance/records/:id
   */
  static async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      await OrganizationFinanceService.deleteRecord(id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}