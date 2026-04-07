// announcements.controller.ts
import type { Request, Response, NextFunction } from 'express';
import {
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  AnnouncementIdSchema,
} from './announcements.schema';
import * as Service from './announcements.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await Service.getAllAnnouncements();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = AnnouncementIdSchema.parse(req.params);
    const data   = await Service.getAnnouncementById(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const input = CreateAnnouncementSchema.parse(req.body);
    const data  = await Service.createAnnouncement(input, req.user!.id);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = AnnouncementIdSchema.parse(req.params);
    const input  = UpdateAnnouncementSchema.parse(req.body);
    const data   = await Service.updateAnnouncement(id, input);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = AnnouncementIdSchema.parse(req.params);
    const data   = await Service.deleteAnnouncement(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}