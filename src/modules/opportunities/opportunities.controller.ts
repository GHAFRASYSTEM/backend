import type { Request, Response, NextFunction } from 'express';
import { opportunitiesService } from './opportunities.service';
import {
  CreateOpportunitySchema,
  UpdateOpportunitySchema,
  MemberListQuerySchema,
  AdminListQuerySchema,
  OpportunityIdSchema,
} from './opportunities.schema';
import { assertSingleImageSource } from './opportunities.image';
import type { OpportunityAction } from './opportunities.rules';
import { Errors } from '../../shared/errors';
import { ok, created, paginated } from '../../shared/response';

// JSON body, or multipart with the same JSON in a text field named "data"
// plus an optional file field named "image".
function readSubmission(req: Request): { raw: unknown; file?: Buffer; imageUrlProvided: boolean } {
  if (!req.is('multipart/form-data')) {
    const raw = req.body;
    return {
      raw,
      imageUrlProvided: !!raw && typeof raw === 'object' && 'image_url' in raw,
    };
  }

  const data = req.body?.data;
  if (typeof data !== 'string' || !data.trim()) {
    throw Errors.badRequest('Send the opportunity fields as JSON in the data field');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    throw Errors.badRequest('data must be JSON');
  }
  return {
    raw,
    file: req.file?.buffer,
    imageUrlProvided: !!raw && typeof raw === 'object' && 'image_url' in raw,
  };
}

// Zod errors are passed to next() and formatted by the global errorHandler.

export const opportunitiesController = {

  // GET /opportunities
  async listPublished(req: Request, res: Response, next: NextFunction) {
    try {
      const query           = MemberListQuerySchema.parse(req.query);
      const { data, total } = await opportunitiesService.listPublished(query);
      return paginated(res, data, total, query.page, query.limit);
    } catch (err) { next(err); }
  },

  // GET /opportunities/:id
  async getPublished(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = OpportunityIdSchema.parse(req.params);
      return ok(res, await opportunitiesService.getPublished(id));
    } catch (err) { next(err); }
  },

  // GET /opportunities/admin
  async listAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query           = AdminListQuerySchema.parse(req.query);
      const { data, total } = await opportunitiesService.listAll(query);
      return paginated(res, data, total, query.page, query.limit);
    } catch (err) { next(err); }
  },

  // GET /opportunities/admin/:id
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = OpportunityIdSchema.parse(req.params);
      return ok(res, await opportunitiesService.getById(id));
    } catch (err) { next(err); }
  },

  // POST /opportunities/admin
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { raw, file, imageUrlProvided } = readSubmission(req);
      assertSingleImageSource(file, imageUrlProvided);
      const input = CreateOpportunitySchema.parse(raw);
      return created(res, await opportunitiesService.create(req.user!.id, input, file));
    } catch (err) { next(err); }
  },

  // PATCH /opportunities/admin/:id
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = OpportunityIdSchema.parse(req.params);
      const { raw, file, imageUrlProvided } = readSubmission(req);
      assertSingleImageSource(file, imageUrlProvided);
      // A file alone is a valid update; the JSON body may be {}.
      const fieldsOnly = !!raw && typeof raw === 'object' ? raw : {};
      const input = file && Object.keys(fieldsOnly).length === 0
        ? {}
        : UpdateOpportunitySchema.parse(raw);
      return ok(res, await opportunitiesService.update(req.user!.id, id, input, file));
    } catch (err) { next(err); }
  },

  // POST /opportunities/admin/:id/{publish|close|archive}
  transition(action: OpportunityAction) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = OpportunityIdSchema.parse(req.params);
        return ok(res, await opportunitiesService.transition(req.user!.id, id, action));
      } catch (err) { next(err); }
    };
  },
};
