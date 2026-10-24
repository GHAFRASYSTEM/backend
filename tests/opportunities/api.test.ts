import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { notificationService } from '../../src/modules/notifications/notifications.service';
import { db, auth } from '../helpers/fake-supabase';
import { NOW, OPPORTUNITY_ID, YESTERDAY, makeOpportunity, validCreateBody } from '../helpers/fixtures';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(notificationService, 'broadcast').mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

const ADMIN_BASE = '/opportunities/admin';

describe('authentication and authorization', () => {
  it.each([
    ['get',  '/opportunities'],
    ['get',  `/opportunities/${OPPORTUNITY_ID}`],
    ['get',  ADMIN_BASE],
    ['post', ADMIN_BASE],
  ] as const)('%s %s requires a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get('/opportunities').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  it.each([
    ['get',   ADMIN_BASE],
    ['get',   `${ADMIN_BASE}/${OPPORTUNITY_ID}`],
    ['post',  ADMIN_BASE],
    ['patch', `${ADMIN_BASE}/${OPPORTUNITY_ID}`],
    ['post',  `${ADMIN_BASE}/${OPPORTUNITY_ID}/publish`],
    ['post',  `${ADMIN_BASE}/${OPPORTUNITY_ID}/close`],
    ['post',  `${ADMIN_BASE}/${OPPORTUNITY_ID}/archive`],
  ] as const)('members get 403 on %s %s', async (method, path) => {
    const res = await request(app)[method](path).set(auth('member')).send({});
    expect(res.status).toBe(403);
    expect(db.queries('opportunities')).toHaveLength(0);
  });
});

describe('member endpoints', () => {
  it('GET /opportunities returns a paginated list of open listings', async () => {
    db.queue('opportunities', { data: [makeOpportunity()], count: 21 });

    const res = await request(app).get('/opportunities?type=job&page=2&limit=10').set(auth('member'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta).toEqual({ total: 21, page: 2, limit: 10, pages: 3 });
    expect(res.body.data[0]).toMatchObject({ id: OPPORTUNITY_ID, availability: 'open', is_expired: false });
  });

  it('admins can use the member endpoints too', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    const res = await request(app).get('/opportunities').set(auth('admin'));
    expect(res.status).toBe(200);
  });

  it('rejects invalid filters with 422', async () => {
    const res = await request(app).get('/opportunities?type=freelance').set(auth('member'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues[0].field).toBe('type');
  });

  it('rejects a non-UUID id with 422', async () => {
    const res = await request(app).get('/opportunities/not-a-uuid').set(auth('member'));
    expect(res.status).toBe(422);
  });

  it('GET /opportunities/:id returns an open listing', async () => {
    db.queue('opportunities', { data: makeOpportunity() });
    const res = await request(app).get(`/opportunities/${OPPORTUNITY_ID}`).set(auth('member'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: OPPORTUNITY_ID, availability: 'open' });
  });

  it('GET /opportunities/:id hides drafts with 404', async () => {
    db.queue('opportunities', { data: makeOpportunity({ status: 'draft' }) });
    const res = await request(app).get(`/opportunities/${OPPORTUNITY_ID}`).set(auth('member'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /opportunities/:id returns 410 for expired listings', async () => {
    db.queue('opportunities', { data: makeOpportunity({ application_deadline: YESTERDAY }) });
    const res = await request(app).get(`/opportunities/${OPPORTUNITY_ID}`).set(auth('member'));
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('OPPORTUNITY_UNAVAILABLE');
  });
});

describe('admin endpoints', () => {
  it('GET /opportunities/admin lists every status with availability', async () => {
    db.queue('opportunities', {
      data: [
        makeOpportunity({ status: 'draft', published_at: null }),
        makeOpportunity({ application_deadline: YESTERDAY }),
        makeOpportunity({ status: 'closed' }),
      ],
      count: 3,
    });

    const res = await request(app).get(`${ADMIN_BASE}?sort_by=application_deadline&sort_order=asc`).set(auth('admin'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((o: any) => o.availability)).toEqual(['draft', 'expired', 'closed']);
  });

  it('GET /opportunities/admin/:id returns any status', async () => {
    db.queue('opportunities', { data: makeOpportunity({ status: 'archived' }) });
    const res = await request(app).get(`${ADMIN_BASE}/${OPPORTUNITY_ID}`).set(auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.availability).toBe('archived');
  });

  it('POST /opportunities/admin creates a draft (201)', async () => {
    db.queue('opportunities', { data: makeOpportunity({ status: 'draft', published_at: null }) });

    const res = await request(app).post(ADMIN_BASE).set(auth('admin')).send(validCreateBody());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'draft', availability: 'draft' });
  });

  it('POST /opportunities/admin reports missing application details per field', async () => {
    const res = await request(app)
      .post(ADMIN_BASE)
      .set(auth('admin'))
      .send(validCreateBody({ application_method: 'url' }));

    expect(res.status).toBe(422);
    expect(res.body.error.issues).toContainEqual(expect.objectContaining({ field: 'application_url' }));
    expect(db.queries('opportunities')).toHaveLength(0);
  });

  it('POST /opportunities/admin rejects a client-supplied status', async () => {
    const res = await request(app).post(ADMIN_BASE).set(auth('admin')).send(validCreateBody({ status: 'published' }));
    expect(res.status).toBe(422);
  });

  it('PATCH /opportunities/admin/:id updates fields', async () => {
    db.queue('opportunities',
      { data: makeOpportunity() },
      { data: makeOpportunity({ title: 'Senior Backend Developer' }) },
    );

    const res = await request(app)
      .patch(`${ADMIN_BASE}/${OPPORTUNITY_ID}`)
      .set(auth('admin'))
      .send({ title: 'Senior Backend Developer' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Senior Backend Developer');
  });

  it('PATCH /opportunities/admin/:id cannot change status', async () => {
    const res = await request(app).patch(`${ADMIN_BASE}/${OPPORTUNITY_ID}`).set(auth('admin')).send({ status: 'closed' });
    expect(res.status).toBe(422);
  });

  it.each([
    ['publish', 'draft',     'published'],
    ['close',   'published', 'closed'],
    ['archive', 'closed',    'archived'],
  ])('POST /:id/%s moves %s to %s', async (action, from, to) => {
    db.queue('opportunities',
      { data: { id: OPPORTUNITY_ID, status: from, application_deadline: null, published_at: null } },
      { data: makeOpportunity({ status: to }) },
    );

    const res = await request(app).post(`${ADMIN_BASE}/${OPPORTUNITY_ID}/${action}`).set(auth('admin'));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(to);
  });

  it('POST /:id/close on a draft returns 409', async () => {
    db.queue('opportunities', {
      data: { id: OPPORTUNITY_ID, status: 'draft', application_deadline: null, published_at: null },
    });

    const res = await request(app).post(`${ADMIN_BASE}/${OPPORTUNITY_ID}/close`).set(auth('admin'));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 404 for an unknown id', async () => {
    db.queue('opportunities', { data: null });
    const res = await request(app).get(`${ADMIN_BASE}/${OPPORTUNITY_ID}`).set(auth('admin'));
    expect(res.status).toBe(404);
  });
});
