import { Request, Response, NextFunction } from 'express';
import {
  ChatRequestSchema,
  TTSRequestSchema,
  PronunciationScoreRequestSchema,
  TranscribeQuerySchema,
} from './french-ai.schema';
import * as FrenchAIService from './french-ai.service';
import { ok } from '../../shared/response';
import { AppError } from '../../shared/errors';

// french-ai.controller.ts

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    const body = ChatRequestSchema.parse(req.body);
    const result = await FrenchAIService.chatWithTutor(body);
    ok(res, result);                          // ✅ not res.json(ok(...))
  } catch (err) {
    next(err);
  }
}

export async function transcribe(req: Request, res: Response, next: NextFunction) {
  try {
    const query = TranscribeQuerySchema.parse(req.query);
    if (!req.file) throw new AppError('No audio file uploaded (field: "audio")', 400);
    const result = await FrenchAIService.transcribeAudio(
      req.file.buffer,
      req.file.mimetype,
      query.language,
    );
    ok(res, result);                          // ✅
  } catch (err) {
    next(err);
  }
}

export async function tts(req: Request, res: Response, next: NextFunction) {
  try {
    const body = TTSRequestSchema.parse(req.body);
    const audioBuffer = await FrenchAIService.synthesizeSpeech(body);
    if (!audioBuffer.length) { res.status(204).end(); return; }
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', String(audioBuffer.length));
    res.send(audioBuffer);                    // ✅ unchanged — binary, not ok()
  } catch (err) {
    next(err);
  }
}

export async function getConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const config = FrenchAIService.getTutorConfig();
    ok(res, config);                          // ✅
  } catch (err) {
    next(err);
  }
}

export async function scorePronunciation(req: Request, res: Response, next: NextFunction) {
  try {
    const body = PronunciationScoreRequestSchema.parse(req.body);
    if (!req.file) throw new AppError('No audio file uploaded (field: "audio")', 400);
    const result = await FrenchAIService.scorePronunciation(
      req.file.buffer,
      req.file.mimetype,
      body.expectedText,
    );
    ok(res, result);                          // ✅
  } catch (err) {
    next(err);
  }
}