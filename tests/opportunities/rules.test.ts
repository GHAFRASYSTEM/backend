import { describe, it, expect } from 'vitest';
import {
  OPPORTUNITY_STATUSES,
  canTransition,
  assertTransition,
  assertEditable,
  assertPublishable,
  todayInParis,
  isExpired,
  computeAvailability,
  withAvailability,
  type OpportunityAction,
  type OpportunityStatus,
} from '../../src/modules/opportunities/opportunities.rules';
import { TODAY, YESTERDAY, TOMORROW } from '../helpers/fixtures';

describe('status transitions', () => {
  const allowed: Record<OpportunityAction, OpportunityStatus[]> = {
    publish: ['draft', 'closed'],
    close:   ['published'],
    archive: ['draft', 'published', 'closed'],
  };

  for (const action of Object.keys(allowed) as OpportunityAction[]) {
    for (const status of OPPORTUNITY_STATUSES) {
      const expected = allowed[action].includes(status);
      it(`${action} from ${status} is ${expected ? 'allowed' : 'rejected'}`, () => {
        expect(canTransition(status, action)).toBe(expected);
      });
    }
  }

  it('assertTransition throws a 409 INVALID_STATUS_TRANSITION', () => {
    expect(() => assertTransition('archived', 'publish')).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'INVALID_STATUS_TRANSITION' }),
    );
  });

  it('archived opportunities are not editable', () => {
    expect(() => assertEditable('archived')).toThrow(expect.objectContaining({ statusCode: 409 }));
    for (const s of ['draft', 'published', 'closed'] as const) {
      expect(() => assertEditable(s)).not.toThrow();
    }
  });
});

describe('todayInParis', () => {
  it('rolls over at midnight Paris time in summer (UTC+2)', () => {
    expect(todayInParis(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14');
    expect(todayInParis(new Date('2026-07-14T22:00:00Z'))).toBe('2026-07-15');
  });

  it('rolls over at midnight Paris time in winter (UTC+1)', () => {
    expect(todayInParis(new Date('2026-01-15T22:59:00Z'))).toBe('2026-01-15');
    expect(todayInParis(new Date('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
  });
});

describe('expiry and availability', () => {
  it('the deadline day itself is still open', () => {
    expect(isExpired(TODAY, TODAY)).toBe(false);
    expect(isExpired(TOMORROW, TODAY)).toBe(false);
    expect(isExpired(YESTERDAY, TODAY)).toBe(true);
    expect(isExpired(null, TODAY)).toBe(false);
  });

  it('published listings are open or expired depending on the deadline', () => {
    expect(computeAvailability({ status: 'published', application_deadline: TOMORROW  }, TODAY)).toBe('open');
    expect(computeAvailability({ status: 'published', application_deadline: null      }, TODAY)).toBe('open');
    expect(computeAvailability({ status: 'published', application_deadline: YESTERDAY }, TODAY)).toBe('expired');
  });

  it('other statuses report themselves regardless of deadline', () => {
    for (const status of ['draft', 'closed', 'archived'] as const) {
      expect(computeAvailability({ status, application_deadline: TOMORROW }, TODAY)).toBe(status);
    }
  });

  it('withAvailability adds availability and is_expired without dropping fields', () => {
    const row = { id: 'x', status: 'closed' as const, application_deadline: YESTERDAY };
    expect(withAvailability(row, TODAY)).toEqual({ ...row, availability: 'closed', is_expired: true });
  });

  it('cannot publish with a past deadline', () => {
    expect(() => assertPublishable(YESTERDAY, TODAY)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'DEADLINE_PASSED' }),
    );
    expect(() => assertPublishable(TODAY, TODAY)).not.toThrow();
    expect(() => assertPublishable(null, TODAY)).not.toThrow();
  });
});
