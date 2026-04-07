export class AppError extends Error {
  constructor(
    public message:    string,
    public statusCode: number = 400,
    public code?:      string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  notFound:    (r: string) => new AppError(`${r} not found`, 404, 'NOT_FOUND'),
  unauthorized: ()         => new AppError('Unauthorized', 401, 'UNAUTHORIZED'),
  forbidden:    ()         => new AppError('Forbidden', 403, 'FORBIDDEN'),
  conflict:    (m: string) => new AppError(m, 409, 'CONFLICT'),
  badRequest:  (m: string) => new AppError(m, 400, 'BAD_REQUEST'),
    internal:     (m = 'Internal server error') =>
    new AppError(m, 500, 'INTERNAL_ERROR'),
};