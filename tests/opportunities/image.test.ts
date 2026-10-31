import { describe, it, expect } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  detectImage,
  storagePathFromPublicUrl,
  assertSingleImageSource,
} from '../../src/modules/opportunities/opportunities.image';

const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png  = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = () => {
  const b = Buffer.alloc(12);
  b.write('RIFF', 0);
  b.write('WEBP', 8);
  return b;
};

describe('detectImage', () => {
  it('accepts JPEG, PNG, and WebP from their file bytes', () => {
    expect(detectImage(jpeg())).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectImage(png())).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectImage(webp())).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('rejects a renamed text file even when the client says it is a JPEG', () => {
    expect(() => detectImage(Buffer.from('not an image'))).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'UNSUPPORTED_IMAGE' }),
    );
  });

  it('rejects an empty file', () => {
    expect(() => detectImage(Buffer.alloc(0))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_IMAGE' }),
    );
  });

  it('rejects a file over 5 MB', () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    expect(() => detectImage(big)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'IMAGE_TOO_LARGE' }),
    );
  });

  it('accepts a file of exactly 5 MB', () => {
    const exact = Buffer.alloc(MAX_IMAGE_BYTES);
    exact[0] = 0xff; exact[1] = 0xd8; exact[2] = 0xff;
    expect(detectImage(exact).ext).toBe('jpg');
  });
});

describe('storagePathFromPublicUrl', () => {
  it('extracts the object path from our public URL', () => {
    const url = 'http://localhost:54321/storage/v1/object/public/opportunity-images/abc/photo.jpg';
    expect(storagePathFromPublicUrl(url)).toBe('abc/photo.jpg');
  });

  it('ignores an external URL', () => {
    expect(storagePathFromPublicUrl('https://cdn.example/cover.jpg')).toBeNull();
    expect(storagePathFromPublicUrl(null)).toBeNull();
  });
});

describe('assertSingleImageSource', () => {
  it('rejects a file and a URL together', () => {
    expect(() => assertSingleImageSource(Buffer.from('x'), true)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'VALIDATION_ERROR' }),
    );
  });

  it('allows either source on its own, or neither', () => {
    expect(() => assertSingleImageSource(undefined, false)).not.toThrow();
    expect(() => assertSingleImageSource(undefined, true)).not.toThrow();
    expect(() => assertSingleImageSource(Buffer.from('x'), false)).not.toThrow();
  });
});
