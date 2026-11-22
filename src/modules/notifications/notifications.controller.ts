import type { Request, Response, NextFunction } from 'express';
import { notify, notificationService } from './notifications.service';
import {
  SendNotificationSchema, PreviewAudienceSchema, PageSchema, MarkReadSchema, PreferencesSchema,
} from './notifications.schema';
import { ok, created, paginated } from '../../shared/response';

export const notificationsController = {

  // GET /notifications?page=&limit=   (member inbox)
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PageSchema.parse(req.query);
      const { data, total, unread } = await notificationService.listForUser(req.user!.id, page, limit);
      return res.status(200).json({
        success: true, data,
        meta: { total, page, limit, pages: Math.ceil(total / limit), unread },
      });
    } catch (err) { next(err); }
  },

  // GET /notifications/unread-count
  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, { unread: await notificationService.unreadCount(req.user!.id) });
    } catch (err) { next(err); }
  },

  // POST /notifications/read   { ids: [...] | "all" }
  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = MarkReadSchema.parse(req.body);
      return ok(res, await notificationService.markRead(req.user!.id, ids));
    } catch (err) { next(err); }
  },

  // GET /notifications/preferences
  async getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await notificationService.getPreferences(req.user!.id));
    } catch (err) { next(err); }
  },

  // PATCH /notifications/preferences
  async updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const patch = PreferencesSchema.parse(req.body);
      return ok(res, await notificationService.updatePreferences(req.user!.id, patch));
    } catch (err) { next(err); }
  },

  // ── Admin ────────────────────────────────────────────────────────────────

  // POST /notifications/admin/send
  async send(req: Request, res: Response, next: NextFunction) {
    try {
      const input = SendNotificationSchema.parse(req.body);
      const result = await notify({
        category: input.category,
        title:    input.title,
        body:     input.body,
        audience: input.audience,
        channels: input.channels,
        data:     input.route ? { route: input.route } : undefined,
        source:   'manual',
        sentBy:   req.user!.id,
      });
      return created(res, result);
    } catch (err) { next(err); }
  },

  // POST /notifications/admin/preview   { audience } → { recipients }
  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const { audience } = PreviewAudienceSchema.parse(req.body);
      return ok(res, await notificationService.previewAudience(audience));
    } catch (err) { next(err); }
  },

  // GET /notifications/admin/campaigns?page=&limit=
  async campaigns(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = PageSchema.parse(req.query);
      const { data, total } = await notificationService.listCampaigns(page, limit);
      return paginated(res, data, total, page, limit);
    } catch (err) { next(err); }
  },
};
