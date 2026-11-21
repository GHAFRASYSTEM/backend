import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../shared/errors';
import { ZodError } from 'zod';

export function errorHandler(
  err:  unknown,
  req:  Request,
  res:  Response,
  next: NextFunction,
) {
  // ── Zod validation errors ─────────────────────────────────────────────
  if (err instanceof ZodError) {
    console.error('❌ Validation failed on:', req.path);
    console.error('Body received:', JSON.stringify(req.body, null, 2));
    console.error('Zod issues:', JSON.stringify(err.issues, null, 2));

    return res.status(422).json({
      success: false,
      error: {
        message: 'Validation failed',
        code:    'VALIDATION_ERROR',
        // Return human-readable messages per field
        issues: err.issues.map(i => ({
          field:   i.path.join('.'),
          message: i.message,
        })),
      },
    });
  }

  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 422 : 400).json({
      success: false,
      error: {
        message: tooBig ? 'Image must be 5 MB or smaller' : err.message,
        code:    tooBig ? 'IMAGE_TOO_LARGE' : 'BAD_REQUEST',
      },
    });
  }

  // ── Known app errors ──────────────────────────────────────────────────
  if (err instanceof AppError) {
    console.error(`❌ AppError [${err.statusCode}]:`, err.message);
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code:    err.code,
      },
    });
  }

  // ── Unknown errors ────────────────────────────────────────────────────
  console.error('❌ Unhandled error:', err);
  return res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      code:    'INTERNAL',
    },
  });
}