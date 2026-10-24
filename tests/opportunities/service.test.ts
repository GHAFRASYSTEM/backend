import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  opportunitiesService as svc,
  sanitizeSearchTerm,
} from '../../src/modules/opportunities/opportunities.service';
import { notificationService } from '../../src/modules/notifications/notifications.service';
import { db, ADMIN_ID } from '../helpers/fake-supabase';
import { NOW, TODAY, YESTERDAY, OPPORTUNITY_ID, makeOpportunity, validCreateBody } from '../helpers/fixtures';
import { CreateOpportunitySchema } from '../../src/modules/opportunities/opportunities.schema';

const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('listPublished (member)', () => {
  it('always restricts to published listings whose deadline has not passed', async () => {
    db.queue('opportunities', { data: [makeOpportunity()], count: 1 });

    const result = await svc.listPublished({ page: 1, limit: 20 });

    const [query] = db.queries('opportunities');
    expect(db.calls(query, 'eq')).toContainEqual(['status', 'published']);
    expect(db.calls(query, 'or')).toContainEqual([
      `application_deadline.is.null,application_deadline.gte.${TODAY}`,
    ]);
    expect(result).toMatchObject({ total: 1, data: [{ availability: 'open', is_expired: false }] });
  });

  it('does not select author or archive columns', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    await svc.listPublished({ page: 1, limit: 20 });

    const [select] = db.calls(db.queries('opportunities')[0], 'select')[0] as [string];
    expect(select).not.toMatch(/created_by|updated_by|archived_at|\*/);
  });

  it('translates page/limit into an inclusive range', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    await svc.listPublished({ page: 3, limit: 10 });
    expect(db.calls(db.queries('opportunities')[0], 'range')).toEqual([[20, 29]]);
  });

  it('applies type, location and search filters', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    await svc.listPublished({ page: 1, limit: 20, type: 'internship', location: 'Lille', search: 'data' });

    const [query] = db.queries('opportunities');
    expect(db.calls(query, 'eq')).toContainEqual(['type', 'internship']);
    expect(db.calls(query, 'ilike')).toContainEqual(['location', '%Lille%']);
    expect(db.calls(query, 'or')).toContainEqual(['title.ilike.%data%,organization.ilike.%data%']);
  });

  it('cannot be tricked into widening the filter through search text', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    await svc.listPublished({ page: 1, limit: 20, search: 'x%,status.eq.draft),(id.gt.0' });

    const orArgs = db.calls(db.queries('opportunities')[0], 'or').map(a => a[0] as string);
    const searchFilter = orArgs.find(f => f.startsWith('title.'))!;
    expect(searchFilter.split(',')).toHaveLength(2);
    expect(searchFilter).not.toMatch(/[()]/);
  });
});

describe('sanitizeSearchTerm', () => {
  it('keeps letters (including accents), digits and common punctuation', () => {
    expect(sanitizeSearchTerm("  Ingénieur  d'études C++ ")).toBe("Ingénieur d'études C++");
  });

  it('removes PostgREST and LIKE syntax', () => {
    expect(sanitizeSearchTerm('a,b(c)d%e_f"g\\h*')).toBe('a b c d e f g h');
  });
});

describe('getPublished (member)', () => {
  it.each(['draft', 'archived'])('hides %s listings behind a 404', async status => {
    db.queue('opportunities', { data: makeOpportunity({ status }) });
    await expect(svc.getPublished(OPPORTUNITY_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for a missing listing', async () => {
    db.queue('opportunities', { data: null });
    await expect(svc.getPublished(OPPORTUNITY_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 410 for a closed listing', async () => {
    db.queue('opportunities', { data: makeOpportunity({ status: 'closed' }) });
    await expect(svc.getPublished(OPPORTUNITY_ID)).rejects.toMatchObject({
      statusCode: 410, code: 'OPPORTUNITY_UNAVAILABLE',
    });
  });

  it('returns 410 for a published listing past its deadline', async () => {
    db.queue('opportunities', { data: makeOpportunity({ application_deadline: YESTERDAY }) });
    await expect(svc.getPublished(OPPORTUNITY_ID)).rejects.toMatchObject({ statusCode: 410 });
  });

  it('returns open listings with availability', async () => {
    db.queue('opportunities', { data: makeOpportunity({ application_deadline: TODAY }) });
    await expect(svc.getPublished(OPPORTUNITY_ID)).resolves.toMatchObject({ availability: 'open' });
  });
});

describe('listAll (admin)', () => {
  it('expired=true selects published listings past their deadline', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    await svc.listAll({ page: 1, limit: 20, expired: true, sort_by: 'created_at', sort_order: 'desc' });

    const [query] = db.queries('opportunities');
    expect(db.calls(query, 'eq')).toContainEqual(['status', 'published']);
    expect(db.calls(query, 'lt')).toContainEqual(['application_deadline', TODAY]);
  });

  it('does not restrict status unless asked', async () => {
    db.queue('opportunities', { data: [], count: 0 });
    await svc.listAll({ page: 1, limit: 20, sort_by: 'title', sort_order: 'asc' });

    const [query] = db.queries('opportunities');
    expect(db.calls(query, 'eq')).toEqual([]);
    expect(db.calls(query, 'order')[0]).toEqual(['title', { ascending: true, nullsFirst: false }]);
  });
});

describe('create', () => {
  it('always creates a draft owned by the admin, with array defaults', async () => {
    db.queue('opportunities', { data: makeOpportunity({ status: 'draft', published_at: null }) });
    const input = CreateOpportunitySchema.parse(validCreateBody({ qualifications: undefined, skills: undefined }));

    const result = await svc.create(ADMIN_ID, input);

    const [inserted] = db.calls(db.queries('opportunities')[0], 'insert')[0] as [Record<string, unknown>];
    expect(inserted).toMatchObject({
      status: 'draft', created_by: ADMIN_ID, updated_by: ADMIN_ID, qualifications: [], skills: [],
    });
    expect(result.availability).toBe('draft');

    await flush();
    const [audit] = db.queries('admin_audit_log');
    expect(db.calls(audit, 'insert')[0][0]).toMatchObject({ admin_id: ADMIN_ID, action: 'opportunity.create' });
  });
});

describe('update', () => {
  it('validates the application method against the merged record', async () => {
    db.queue('opportunities', { data: makeOpportunity({ application_method: 'url', application_email: null }) });

    await expect(svc.update(ADMIN_ID, OPPORTUNITY_ID, { application_method: 'email' }))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(db.queries('opportunities')).toHaveLength(1);
  });

  it('refuses to edit archived listings', async () => {
    db.queue('opportunities', { data: makeOpportunity({ status: 'archived' }) });
    await expect(svc.update(ADMIN_ID, OPPORTUNITY_ID, { title: 'Renamed listing' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'OPPORTUNITY_ARCHIVED' });
  });

  it('guards the write against a concurrent archive', async () => {
    db.queue('opportunities',
      { data: makeOpportunity() },
      { data: null },
    );

    await expect(svc.update(ADMIN_ID, OPPORTUNITY_ID, { title: 'Renamed listing' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    const write = db.queries('opportunities')[1];
    expect(db.calls(write, 'in')).toEqual([['status', ['draft', 'published', 'closed']]]);
    expect(db.calls(write, 'update')[0][0]).toMatchObject({ title: 'Renamed listing', updated_by: ADMIN_ID });
  });
});

describe('transition', () => {
  it('first publish sets published_at, uses compare-and-set and broadcasts once', async () => {
    const broadcast = vi.spyOn(notificationService, 'broadcast').mockResolvedValue(undefined);
    db.queue('opportunities',
      { data: { id: OPPORTUNITY_ID, status: 'draft', application_deadline: null, published_at: null } },
      { data: makeOpportunity({ published_at: NOW.toISOString() }) },
    );

    const result = await svc.transition(ADMIN_ID, OPPORTUNITY_ID, 'publish');

    const write = db.queries('opportunities')[1];
    expect(db.calls(write, 'update')[0][0]).toMatchObject({
      status: 'published', published_at: NOW.toISOString(), closed_at: null, updated_by: ADMIN_ID,
    });
    expect(db.calls(write, 'eq')).toContainEqual(['status', 'draft']);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][1]).toEqual({ type: 'opportunity', opportunity_id: OPPORTUNITY_ID });
    expect(result.availability).toBe('open');
  });

  it('re-publishing a closed listing keeps published_at and does not notify again', async () => {
    const broadcast = vi.spyOn(notificationService, 'broadcast').mockResolvedValue(undefined);
    const firstPublished = '2026-10-01T08:00:00.000Z';
    db.queue('opportunities',
      { data: { id: OPPORTUNITY_ID, status: 'closed', application_deadline: null, published_at: firstPublished } },
      { data: makeOpportunity({ published_at: firstPublished }) },
    );

    await svc.transition(ADMIN_ID, OPPORTUNITY_ID, 'publish');

    expect(db.calls(db.queries('opportunities')[1], 'update')[0][0]).toMatchObject({ published_at: firstPublished });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects publishing when the deadline has passed', async () => {
    db.queue('opportunities', {
      data: { id: OPPORTUNITY_ID, status: 'draft', application_deadline: YESTERDAY, published_at: null },
    });
    await expect(svc.transition(ADMIN_ID, OPPORTUNITY_ID, 'publish'))
      .rejects.toMatchObject({ statusCode: 422, code: 'DEADLINE_PASSED' });
    expect(db.queries('opportunities')).toHaveLength(1);
  });

  it('rejects invalid transitions without writing', async () => {
    db.queue('opportunities', {
      data: { id: OPPORTUNITY_ID, status: 'archived', application_deadline: null, published_at: null },
    });
    await expect(svc.transition(ADMIN_ID, OPPORTUNITY_ID, 'close'))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STATUS_TRANSITION' });
    expect(db.queries('opportunities')).toHaveLength(1);
  });

  it('reports a conflict when another admin changed the status first', async () => {
    const broadcast = vi.spyOn(notificationService, 'broadcast').mockResolvedValue(undefined);
    db.queue('opportunities',
      { data: { id: OPPORTUNITY_ID, status: 'draft', application_deadline: null, published_at: null } },
      { data: null },
    );

    await expect(svc.transition(ADMIN_ID, OPPORTUNITY_ID, 'publish'))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    ['close',   'published', { status: 'closed',   closed_at:   NOW.toISOString() }],
    ['archive', 'closed',    { status: 'archived', archived_at: NOW.toISOString() }],
  ] as const)('%s sets the matching timestamp', async (action, from, expected) => {
    db.queue('opportunities',
      { data: { id: OPPORTUNITY_ID, status: from, application_deadline: null, published_at: NOW.toISOString() } },
      { data: makeOpportunity(expected) },
    );

    await svc.transition(ADMIN_ID, OPPORTUNITY_ID, action);

    expect(db.calls(db.queries('opportunities')[1], 'update')[0][0]).toMatchObject(expected);
    await flush();
    expect(db.calls(db.queries('admin_audit_log')[0], 'insert')[0][0])
      .toMatchObject({ action: `opportunity.${action}` });
  });

  it('returns 404 for a missing opportunity', async () => {
    db.queue('opportunities', { data: null });
    await expect(svc.transition(ADMIN_ID, OPPORTUNITY_ID, 'close')).rejects.toMatchObject({ statusCode: 404 });
  });
});
