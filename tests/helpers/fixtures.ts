import { ADMIN_ID } from './fake-supabase';

export const OPPORTUNITY_ID = 'a3bb189e-8bf9-4888-9912-ace4e6543002';

// Fixed "now" used by tests that depend on the Paris date.
export const NOW       = new Date('2026-10-24T10:00:00Z');
export const TODAY     = '2026-10-24';
export const YESTERDAY = '2026-10-23';
export const TOMORROW  = '2026-10-25';

export function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id:                       OPPORTUNITY_ID,
    title:                    'Junior Backend Developer',
    organization:             'Acme Lille',
    type:                     'job',
    description:              'Build and maintain APIs for our logistics platform.',
    qualifications:           ['Bachelor in Computer Science'],
    skills:                   ['TypeScript', 'PostgreSQL'],
    location:                 'Lille, France',
    application_deadline:     TOMORROW,
    application_method:       'url',
    application_url:          'https://acme.example/jobs/42',
    application_email:        null,
    application_instructions: null,
    contact_name:             null,
    contact_email:            null,
    contact_phone:            null,
    status:                   'published',
    published_at:             '2026-10-20T09:00:00Z',
    closed_at:                null,
    archived_at:              null,
    created_by:               ADMIN_ID,
    updated_by:               ADMIN_ID,
    created_at:               '2026-10-19T09:00:00Z',
    updated_at:               '2026-10-20T09:00:00Z',
    ...overrides,
  };
}

export function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    title:              'Data Analyst Intern',
    organization:       'Ghana Embassy Paris',
    type:               'internship',
    description:        'Six-month internship supporting the economic affairs team.',
    qualifications:     ['Master student in economics or statistics'],
    skills:             ['Excel', 'Python'],
    location:           'Paris, France',
    application_deadline: TOMORROW,
    application_method: 'email',
    application_email:  'careers@embassy.example',
    ...overrides,
  };
}
