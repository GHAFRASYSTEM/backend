-- Jobs and internship opportunities published by GHAFRA admins.
-- Members only ever see rows that are published and not past their deadline;
-- that rule lives in the API (opportunities.service.ts). RLS is enabled with
-- no policies so the anon/authenticated keys cannot touch this table directly.

create type public.opportunity_type as enum ('job', 'internship');

create type public.opportunity_status as enum ('draft', 'published', 'closed', 'archived');

create type public.opportunity_application_method as enum ('url', 'email', 'other');

create table public.opportunities (
  id                        uuid primary key default gen_random_uuid(),

  title                     text not null check (char_length(title) between 3 and 200),
  organization              text not null check (char_length(organization) between 2 and 200),
  type                      public.opportunity_type not null,
  description               text not null check (char_length(description) >= 20),
  qualifications            text[] not null default '{}',
  skills                    text[] not null default '{}',
  location                  text not null check (char_length(location) between 2 and 200),

  -- Inclusive: the opportunity is open until the end of this day (Europe/Paris).
  application_deadline      date,

  application_method        public.opportunity_application_method not null,
  application_url           text,
  application_email         text,
  application_instructions  text,

  contact_name              text,
  contact_email             text,
  contact_phone             text,

  status                    public.opportunity_status not null default 'draft',
  published_at              timestamptz,
  closed_at                 timestamptz,
  archived_at               timestamptz,

  created_by                uuid not null
    constraint opportunities_created_by_profiles_fkey references public.profiles (id),
  updated_by                uuid
    constraint opportunities_updated_by_profiles_fkey references public.profiles (id),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint opportunities_application_details_check check (
    (application_method = 'url'   and application_url          is not null) or
    (application_method = 'email' and application_email        is not null) or
    (application_method = 'other' and application_instructions is not null)
  ),
  constraint opportunities_published_at_check check (
    status = 'draft' or published_at is not null or status = 'archived'
  )
);

create index opportunities_status_published_at_idx
  on public.opportunities (status, published_at desc);

create index opportunities_type_idx
  on public.opportunities (type);

create index opportunities_application_deadline_idx
  on public.opportunities (application_deadline);

create or replace function public.opportunities_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.opportunities_set_updated_at();

alter table public.opportunities enable row level security;
