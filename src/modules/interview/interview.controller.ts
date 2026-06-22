import type { Request, Response, NextFunction } from 'express';
import { Errors } from '../../shared/errors';
import * as interviewService from './interview.service';
import type { UpsertContextBody, RespondBody } from './interview.types';

// POST /interview/context
export async function upsertContext(
  req: Request<unknown, unknown, UpsertContextBody>,
  res: Response,
  next: NextFunction,
) {
  try {
    await interviewService.upsertContext(req.user!.id, req.body);
    res.json({ data: { status: 'success', message: 'context saved' } });
  } catch (err) {
    next(err);
  }
}

// GET /interview/context
export async function getContext(req: Request, res: Response, next: NextFunction) {
  try {
    const context = await interviewService.getContext(req.user!.id);
    res.json({ data: context });
  } catch (err) {
    next(err);
  }
}

// POST /interview/respond
export async function respond(
  req: Request<unknown, unknown, RespondBody>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { text } = req.body;
    if (!text?.trim()) throw Errors.badRequest('text is required');

    const result = await interviewService.respond(req.user!.id, text);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

// POST /interview/transcribe
export async function transcribe(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('📢 Transcribe hit | File:', !!req.file, 'Size:', req.file?.buffer?.length);
    if (!req.file) throw Errors.badRequest('audio file is required');

    const text = await interviewService.transcribe(req.file.buffer, req.file.mimetype);
    res.json({ text });
  } catch (err) {
    console.error('❌ Transcribe failed:', err);
    next(err);
  }
}