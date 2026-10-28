import { AppError } from '../../shared/errors';

export const OPPORTUNITY_TYPES    = ['job', 'internship'] as const;
export const OPPORTUNITY_STATUSES = ['draft', 'published', 'closed', 'archived'] as const;
export const APPLICATION_METHODS  = ['url', 'email', 'other'] as const;

export type OpportunityType     = typeof OPPORTUNITY_TYPES[number];
export type OpportunityStatus   = typeof OPPORTUNITY_STATUSES[number];
export type ApplicationMethod   = typeof APPLICATION_METHODS[number];
export type OpportunityAction   = 'publish' | 'close' | 'archive';
export type Availability        = 'open' | 'expired' | OpportunityStatus;

export const TRANSITIONS: Record<OpportunityAction, {
  from: readonly OpportunityStatus[];
  to:   OpportunityStatus;
}> = {
  publish: { from: ['draft', 'closed'],              to: 'published' },
  close:   { from: ['published'],                    to: 'closed'    },
  archive: { from: ['draft', 'published', 'closed'], to: 'archived'  },
};

export const EDITABLE_STATUSES: readonly OpportunityStatus[] = ['draft', 'published', 'closed'];

export function canTransition(from: OpportunityStatus, action: OpportunityAction): boolean {
  return TRANSITIONS[action].from.includes(from);
}

export function assertTransition(from: OpportunityStatus, action: OpportunityAction): void {
  if (!canTransition(from, action)) {
    throw new AppError(
      `Cannot ${action} an opportunity that is ${from}`,
      409,
      'INVALID_STATUS_TRANSITION',
    );
  }
}

export function assertEditable(status: OpportunityStatus): void {
  if (!EDITABLE_STATUSES.includes(status)) {
    throw new AppError('Archived opportunities cannot be edited', 409, 'OPPORTUNITY_ARCHIVED');
  }
}

// Deadlines are calendar dates in France, so "today" must be the Paris date,
// not the server's UTC date (they differ for 1-2 hours around midnight).
export function todayInParis(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(now);
}

// The deadline day itself is still open.
export function isExpired(deadline: string | null | undefined, today: string): boolean {
  return !!deadline && deadline < today;
}

export function assertPublishable(deadline: string | null | undefined, today: string): void {
  if (isExpired(deadline, today)) {
    throw new AppError(
      'The application deadline has passed. Update it before publishing.',
      422,
      'DEADLINE_PASSED',
    );
  }
}

export function computeAvailability(
  row:   { status: OpportunityStatus; application_deadline: string | null },
  today: string,
): Availability {
  if (row.status !== 'published') return row.status;
  return isExpired(row.application_deadline, today) ? 'expired' : 'open';
}

export function withAvailability<T extends { status: OpportunityStatus; application_deadline: string | null }>(
  row:   T,
  today: string,
): T & { availability: Availability; is_expired: boolean } {
  return {
    ...row,
    availability: computeAvailability(row, today),
    is_expired:   isExpired(row.application_deadline, today),
  };
}
