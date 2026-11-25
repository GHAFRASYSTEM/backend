import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('GET /health', () => {
  it('responds ok without starting the server', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('/jobs/tick', () => {
  it('rejects calls without the jobs secret', async () => {
    expect((await request(app).post('/jobs/tick')).status).toBe(401);
    expect((await request(app).get('/jobs/tick?key=wrong-secret-value')).status).toBe(401);
  });
});

describe('POST /client-errors', () => {
  it('accepts a crash report without auth', async () => {
    const res = await request(app).post('/client-errors').send({ message: 'boom', source: 'test', platform: 'ios' });
    expect(res.status).toBe(204);
  });
});
