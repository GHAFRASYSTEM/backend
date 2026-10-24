import type { Response } from 'express';

export function ok<T>(
  res: Response,
  data: T,
  status = 200,
  additionalFields: Record<string, unknown> = {},
) {
  return res.status(status).json({ success: true, data, ...additionalFields });
}

export function created<T>(res: Response, data: T) {
  return ok(res, data, 201);
}

export function paginated<T>(
  res:   Response,
  data:  T[],
  total: number,
  page:  number,
  limit: number,
) {
  return res.status(200).json({
    success: true,
    data,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}