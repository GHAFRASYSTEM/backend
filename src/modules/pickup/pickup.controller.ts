import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { pickupService } from './pickup.service';
import {
  CreatePickupRequestSchema,
  UpdatePickupRequestSchema,
  UploadUrlRequestSchema,
  AdminUpdateStatusSchema,
  ListPickupRequestsQuerySchema,
} from './pickup.schema';
import { ok, created } from '../../shared/response';

// ── Shared Zod error handler (matches auth.controller.ts pattern) ─────────
function handleZodError(err: unknown, path: string, res: Response): boolean {
  if (err instanceof ZodError) {
    console.error(`❌ ${path} validation:`, err.issues);
    res.status(422).json({
      success: false,
      error: {
        message: 'Validation failed',
        code:    'VALIDATION_ERROR',
        issues:  err.issues.map(i => ({
          field:   i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return true;
  }
  return false;
}

export const pickupController = {

  // POST /pickup/upload-url
  async getUploadUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = UploadUrlRequestSchema.parse(req.body);
      const result = await pickupService.createUploadUrl(req.user!.id, input);
      return ok(res, result);
    } catch (err) {
      if (handleZodError(err, '/pickup/upload-url', res)) return;
      next(err);
    }
  },

  // POST /pickup
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = CreatePickupRequestSchema.parse(req.body);
      const request = await pickupService.createRequest(req.user!.id, input);
      return created(res, request);
    } catch (err) {
      if (handleZodError(err, '/pickup', res)) return;
      next(err);
    }
  },

  // GET /pickup/me
  async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const request = await pickupService.getMyRequest(req.user!.id);
      return ok(res, request);
    } catch (err) {
      next(err);
    }
  },

  // PATCH /pickup/me
  async updateMine(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = UpdatePickupRequestSchema.parse(req.body);
      const request = await pickupService.updateMyRequest(req.user!.id, input);
      return ok(res, request);
    } catch (err) {
      if (handleZodError(err, '/pickup/me', res)) return;
      next(err);
    }
  },

  // DELETE /pickup/me
  async cancelMine(req: Request, res: Response, next: NextFunction) {
    try {
      const request = await pickupService.cancelMyRequest(req.user!.id);
      return ok(res, request);
    } catch (err) {
      next(err);
    }
  },

  // GET /pickup (admin)
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query    = ListPickupRequestsQuerySchema.parse(req.query);
      const requests = await pickupService.listRequests(query);
      return ok(res, requests);
    } catch (err) {
      if (handleZodError(err, '/pickup (list)', res)) return;
      next(err);
    }
  },

  // PATCH /pickup/:id/status (admin)
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const rawId = req.params.id;
      const id    = Array.isArray(rawId) ? rawId[0] : rawId;

      const input   = AdminUpdateStatusSchema.parse(req.body);
      const request = await pickupService.adminUpdateStatus(id, input);
      return ok(res, request);
    } catch (err) {
      if (handleZodError(err, '/pickup/:id/status', res)) return;
      next(err);
    }
  },
};