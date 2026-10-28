import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { db, auth } from './helpers/fake-supabase';

describe('GET /transactions/all', () => {
  it('is available to admins (req.user.role is always "authenticated")', async () => {
    db.queue('payments', { data: [{ id: 'p1', type: 'dues' }] });

    const res = await request(app).get('/transactions/all').set(auth('admin'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'p1', type: 'dues' }]);
  });

  it('is forbidden to members', async () => {
    const res = await request(app).get('/transactions/all').set(auth('member'));
    expect(res.status).toBe(403);
    expect(db.queries('payments')).toHaveLength(0);
  });
});
