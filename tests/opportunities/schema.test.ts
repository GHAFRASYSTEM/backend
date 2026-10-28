import { describe, it, expect } from 'vitest';
import {
  CreateOpportunitySchema,
  UpdateOpportunitySchema,
  AdminListQuerySchema,
  MemberListQuerySchema,
  OpportunityIdSchema,
} from '../../src/modules/opportunities/opportunities.schema';
import { validCreateBody } from '../helpers/fixtures';

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map(i => i.path.join('.')) ?? [];

describe('CreateOpportunitySchema', () => {
  it('accepts a valid body and trims strings', () => {
    const parsed = CreateOpportunitySchema.parse(validCreateBody({ title: '  Data Analyst Intern  ' }));
    expect(parsed.title).toBe('Data Analyst Intern');
  });

  it.each([
    ['url',   'application_url'],
    ['email', 'application_email'],
    ['other', 'application_instructions'],
  ])('application_method "%s" requires %s', (method, field) => {
    const result = CreateOpportunitySchema.safeParse(validCreateBody({
      application_method: method,
      application_email:  undefined,
    }));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain(field);
  });

  it('rejects fields the client must not set', () => {
    const result = CreateOpportunitySchema.safeParse(validCreateBody({ status: 'published', created_by: 'x' }));
    expect(result.success).toBe(false);
  });

  it('only accepts http(s) application URLs', () => {
    const result = CreateOpportunitySchema.safeParse(validCreateBody({
      application_method: 'url',
      application_url:    'javascript:alert(1)',
    }));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('application_url');
  });

  it('requires deadlines as YYYY-MM-DD', () => {
    const result = CreateOpportunitySchema.safeParse(validCreateBody({ application_deadline: '24/10/2026' }));
    expect(issuePaths(result)).toContain('application_deadline');
  });

  it('rejects an unknown opportunity type', () => {
    expect(CreateOpportunitySchema.safeParse(validCreateBody({ type: 'freelance' })).success).toBe(false);
  });
});

describe('UpdateOpportunitySchema', () => {
  it('rejects an empty body', () => {
    expect(UpdateOpportunitySchema.safeParse({}).success).toBe(false);
  });

  it('rejects status changes (those go through the action endpoints)', () => {
    expect(UpdateOpportunitySchema.safeParse({ status: 'published' }).success).toBe(false);
  });

  it('does not inject defaults for fields that were not sent', () => {
    expect(UpdateOpportunitySchema.parse({ title: 'New title here' })).toEqual({ title: 'New title here' });
  });

  it('allows clearing the deadline', () => {
    expect(UpdateOpportunitySchema.parse({ application_deadline: null })).toEqual({ application_deadline: null });
  });
});

describe('list query schemas', () => {
  it('applies pagination defaults and caps limit at 50', () => {
    expect(MemberListQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
    expect(MemberListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('parses expired=false as false (not truthy like z.coerce.boolean)', () => {
    expect(AdminListQuerySchema.parse({ expired: 'false' }).expired).toBe(false);
    expect(AdminListQuerySchema.parse({ expired: 'true'  }).expired).toBe(true);
  });

  it('only allows known sort fields', () => {
    expect(AdminListQuerySchema.parse({}).sort_by).toBe('created_at');
    expect(AdminListQuerySchema.safeParse({ sort_by: 'created_by' }).success).toBe(false);
  });

  it('requires UUID ids', () => {
    expect(OpportunityIdSchema.safeParse({ id: 'admin' }).success).toBe(false);
  });
});
