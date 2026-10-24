import type { Request, Response, NextFunction } from 'express';
import { opportunitiesService } from './opportunities.service';
import {
  CreateOpportunitySchema,
  UpdateOpportunitySchema,
  MemberListQuerySchema,
  AdminListQuerySchema,
  OpportunityIdSchema,
} from './opportunities.schema';
import type { OpportunityAction } from './opportunities.rules';
import { ok, created, paginated } from '../../shared/response';

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
      const input = CreateOpportunitySchema.parse(req.body);
      return created(res, await opportunitiesService.create(req.user!.id, input));
    } catch (err) { next(err); }
  },

  // PATCH /opportunities/admin/:id
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = OpportunityIdSchema.parse(req.params);
      const input  = UpdateOpportunitySchema.parse(req.body);
      return ok(res, await opportunitiesService.update(req.user!.id, id, input));
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
