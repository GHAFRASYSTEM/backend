import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { Errors }   from '../shared/errors';

export async function requireAuth(
  req:  Request,
  res:  Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(Errors.unauthorized());
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    // Use getUser — this validates the JWT against Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('Auth error:', error.message);
      return next(Errors.unauthorized());
    }

    if (!data.user) {
      return next(Errors.unauthorized());
    }

    req.user = data.user;
    next();
  } catch (err) {
    console.error('Auth middleware threw:', err);
    return next(Errors.unauthorized());
  }
}