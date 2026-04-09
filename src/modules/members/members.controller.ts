import type { Request, Response, NextFunction } from 'express';
import { ZodError }      from 'zod';
import { membersService } from './members.service';
import {
  ListMembersSchema,
  UpdateMemberSchema,
  ToggleVerifySchema,
} from './members.schema';
import { ok } from '../../shared/response';

export const membersController = {

  // GET /members?page=1&limit=20&search=kwame&region=Accra
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('[members] list query:', req.query);
      const input  = ListMembersSchema.parse(req.query);
      const result = await membersService.listMembers(input);
      return ok(res, result);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(422).json({
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
      }
      next(err);
    }
  },

  // GET /members/stats
  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await membersService.getStats();
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // GET /members/:id
  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const member = await membersService.getMember(req.params.id as string);
      return ok(res, member);
    } catch (err) { next(err); }
  },

  // PATCH /members/:id
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('[members] update body:', JSON.stringify(req.body, null, 2));
      const input  = UpdateMemberSchema.parse(req.body);
      const member = await membersService.updateMember(req.params.id as string, input);
      return ok(res, member);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(422).json({
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
      }
      next(err);
    }
  },

  // PATCH /members/:id/verify
  async toggleVerify(req: Request, res: Response, next: NextFunction) {
    try {
      const { is_verified } = ToggleVerifySchema.parse(req.body);
      const member = await membersService.toggleVerified(req.params.id as string, is_verified);
      return ok(res, member);
    } catch (err) { next(err); }
  },

  // DELETE /members/:id
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      // Prevent self-deletion
      if (req.params.id === req.user!.id) {
        return res.status(400).json({
          success: false,
          error: { message: 'Cannot delete your own account', code: 'SELF_DELETE' },
        });
      }
      const result = await membersService.deleteMember(req.params.id as string);
      return ok(res, result);
    } catch (err) { next(err); }
  },
};