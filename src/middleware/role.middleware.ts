import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { Errors }   from '../shared/errors';

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(Errors.unauthorized());

    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error || !data) return next(Errors.unauthorized());

    if (!roles.includes(data.role)) return next(Errors.forbidden());

    next();
  };
}