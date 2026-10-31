import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/errors';

export const IMAGE_BUCKET = 'opportunity-images';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES = [
  {
    mime: 'image/jpeg',
    ext:  'jpg',
    match: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext:  'png',
    match: (b: Buffer) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    ext:  'webp',
    match: (b: Buffer) =>
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
] as const;

export type DetectedImage = { mime: string; ext: string };

// Trust the file bytes, not the Content-Type header.
export function detectImage(buffer: Buffer): DetectedImage {
  if (buffer.length === 0) {
    throw new AppError('Image file is empty', 422, 'UNSUPPORTED_IMAGE');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new AppError('Image must be 5 MB or smaller', 422, 'IMAGE_TOO_LARGE');
  }
  const found = TYPES.find(type => type.match(buffer));
  if (!found) {
    throw new AppError('Image must be a JPEG, PNG, or WebP file', 422, 'UNSUPPORTED_IMAGE');
  }
  return { mime: found.mime, ext: found.ext };
}

// Public object URLs look like
// {supabase}/storage/v1/object/public/opportunity-images/{path}.
// Anything else (a pasted external URL) is not ours to delete.
export function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${IMAGE_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = url.slice(at + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

export function assertSingleImageSource(file: Buffer | undefined, imageUrlProvided: boolean): void {
  if (file && imageUrlProvided) {
    throw new AppError(
      'Provide either an image file or an image_url, not both',
      422,
      'VALIDATION_ERROR',
    );
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

// JSON create/update is unchanged. A file is sent as multipart/form-data
// with the opportunity JSON in a text field named "data" and the file in "image".
export function imageUpload(req: Request, res: Response, next: NextFunction) {
  const type = req.headers['content-type'] ?? '';
  if (!type.includes('multipart/form-data')) return next();
  upload.single('image')(req, res, next);
}
