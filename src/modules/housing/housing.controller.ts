import type { Request, Response, NextFunction } from 'express';
import { ZodError }       from 'zod';
import { housingService } from './housing.service';
import {
  CreateHousingSchema, UpdateHousingSchema,
  ListHousingSchema, RoomRequestSchema,
  UpdateRequestStatusSchema,
} from './housing.schema';
import { ok, created } from '../../shared/response';

function handleZod(err: unknown, res: Response, next: NextFunction) {
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

export const housingController = {

  // GET /housing
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const input  = ListHousingSchema.parse(req.query);
      const result = await housingService.list(input);
      return ok(res, result);
    } catch (err) { handleZod(err, res, next); }
  },

  // GET /housing/:id
  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const housing = await housingService.getOne(req.params.id as string);
      return ok(res, housing);
    } catch (err) { next(err); }
  },

  // POST /housing  (admin)
  // Body: { ...housingFields, images: string[] }  ← images are base64 data URLs
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('[housing] create — fields:', Object.keys(req.body));
      const { images: imageDataUrls = [], ...rest } = req.body;
      const input   = CreateHousingSchema.parse(rest);
      const housing = await housingService.create(req.user!.id, input, imageDataUrls);
      return created(res, housing);
    } catch (err) { handleZod(err, res, next); }
  },

  // PATCH /housing/:id  (admin)
  // Body: { ...fields, new_images: string[], removed_images: string[] }
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { new_images = [], removed_images = [], ...rest } = req.body;
      const input   = UpdateHousingSchema.parse(rest);
      const housing = await housingService.update(req.params.id as string, input, new_images, removed_images);
      return ok(res, housing);
    } catch (err) { handleZod(err, res, next); }
  },

  // DELETE /housing/:id  (admin)
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await housingService.delete(req.params.id as string);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // POST /housing/:id/request  (user)
  async requestRoom(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = RoomRequestSchema.parse(req.body);
      const request = await housingService.requestRoom(req.user!.id, req.params.id as string, input);
      return created(res, request);
    } catch (err) { handleZod(err, res, next); }
  },

  // GET /housing/:id/requests  (admin — see who requested this room)
  async getRequestsForHousing(req: Request, res: Response, next: NextFunction) {
    try {
      const requests = await housingService.getRequestsForHousing(req.params.id as string);
      return ok(res, requests);
    } catch (err) { next(err); }
  },

  // GET /housing/requests/all?status=pending  (admin — all requests)
  async getAllRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const status   = req.query.status as string | undefined;
      const requests = await housingService.getAllRequests(status);
      return ok(res, requests);
    } catch (err) { next(err); }
  },

  // GET /housing/requests/mine  (user — their own requests)
  async getMyRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const requests = await housingService.getMyRequests(req.user!.id);
      return ok(res, requests);
    } catch (err) { next(err); }
  },

  // PATCH /housing/requests/:requestId/status  (admin)
  async updateRequestStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const input   = UpdateRequestStatusSchema.parse(req.body);
      const request = await housingService.updateRequestStatus(req.params.requestId as string, input);
      return ok(res, request);
    } catch (err) { handleZod(err, res, next); }
  },

  // PATCH /housing/requests/:requestId/withdraw  (user — withdraw own request)
  async withdrawRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const request = await housingService.withdrawRequest(req.params.requestId as string, req.user!.id);
      return ok(res, request);
    } catch (err) { next(err); }
  },
};