import type { Request, Response, NextFunction } from 'express';
import {
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  PaginationSchema,
  AnnouncementIdSchema,
} from './announcements.schema';
import { announcementsService } from './announcements.service';
import { ok, created, paginated } from '../../shared/response';

// ── GET /announcements?page=1&limit=10 ────────────────────────────────────────
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const pagination      = PaginationSchema.parse(req.query);
    const { data, total } = await announcementsService.getAll(pagination);
    return paginated(res, data, total, pagination.page, pagination.limit);
  } catch (err) {
    next(err);
  }
}

// ── GET /announcements/:id ────────────────────────────────────────────────────
export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = AnnouncementIdSchema.parse(req.params);
    const data   = await announcementsService.getById(id);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

// ── POST /announcements ───────────────────────────────────────────────────────
// Body: { category, title, body, image?: "<base64 data URI>" }
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { image, ...rest } = req.body;
    const input = CreateAnnouncementSchema.parse(rest);
    const data  = await announcementsService.create(input, image ?? undefined);
    return created(res, data);
  } catch (err) {
    next(err);
  }
}

// ── PATCH /announcements/:id ──────────────────────────────────────────────────
// Body: any subset of { category, title, body, image? }
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { id }           = AnnouncementIdSchema.parse(req.params);
    const { image, ...rest } = req.body;
    const input            = UpdateAnnouncementSchema.parse(rest);
    const data             = await announcementsService.update(id, input, image ?? undefined);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

// ── DELETE /announcements/:id ─────────────────────────────────────────────────
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = AnnouncementIdSchema.parse(req.params);
    const data   = await announcementsService.remove(id);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}