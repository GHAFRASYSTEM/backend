-- 011 — Notification inbox + preferences + delivery log, app feature settings,
-- French practice tracking, and multi-month (advance) dues payments.
--
-- Safe to run on the live database: every statement is idempotent and none
-- of them touch existing rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- Push tokens. The table already exists in production (it was created before
-- 006_fcm_tokens.sql was committed empty); this only fills in anything missing.
-- Tokens are either Expo push tokens (ExponentPushToken[...]) or raw FCM tokens.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.fcm_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   text check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fcm_tokens_user_id_idx on public.fcm_tokens (user_id);
alter table public.fcm_tokens enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- In-app notification inbox: one row per member per notification.
-- Named user_notifications so it never collides with an older "notifications".
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  category    text not null default 'general',
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  campaign_id uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);
create index if not exists user_notifications_unread_idx
  on public.user_notifications (user_id) where read_at is null;
alter table public.user_notifications enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- One row per send (custom from the dashboard, or automatic from a job), so
-- admins can see what went out and to how many people.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_campaigns (
  id             uuid primary key default gen_random_uuid(),
  category       text not null,
  title          text not null,
  body           text not null,
  audience       jsonb not null default '{"type":"all"}'::jsonb,
  channels       text[] not null default array['push'],
  source         text not null default 'manual',      -- manual | automatic
  job_key        text unique,                          -- idempotency for jobs
  sent_by        uuid references public.profiles (id) on delete set null,
  recipients     integer not null default 0,
  push_sent      integer not null default 0,
  push_failed    integer not null default 0,
  emails_sent    integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists notification_campaigns_created_idx
  on public.notification_campaigns (created_at desc);
alter table public.notification_campaigns enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-member category switches. Missing row = everything on.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  meetings         boolean not null default true,
  attendance       boolean not null default true,
  dues             boolean not null default true,
  announcements    boolean not null default true,
  french_practice  boolean not null default true,
  opportunities    boolean not null default true,
  general          boolean not null default true,
  email_enabled    boolean not null default true,
  updated_at       timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- App-wide feature switches, editable from the dashboard and read by the app.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('card_section_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- One row per member per Paris day they practised French (any AI tutor call).
-- Drives the daily practice reminder and the streak on the Learn tab.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.french_practice_log (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  practiced_on date not null,
  activities   integer not null default 1,
  last_activity text,
  updated_at   timestamptz not null default now(),
  primary key (user_id, practiced_on)
);
alter table public.french_practice_log enable row level security;

-- Atomic upsert used by the backend on every tutor call
create or replace function public.log_french_practice(p_user uuid, p_day date, p_activity text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.french_practice_log (user_id, practiced_on, activities, last_activity)
  values (p_user, p_day, 1, p_activity)
  on conflict (user_id, practiced_on)
  do update set activities    = french_practice_log.activities + 1,
                last_activity = excluded.last_activity,
                updated_at    = now();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Advance dues: one Stripe payment can now cover several months, recorded as
-- one payments row per month sharing the same stripe_payment_intent_id.
-- Drop a single-column unique on the intent id if one exists, and guard per
-- month instead.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.payments drop constraint if exists payments_stripe_payment_intent_id_key;
drop index if exists public.payments_stripe_payment_intent_id_key;

create unique index if not exists payments_intent_month_uidx
  on public.payments (stripe_payment_intent_id, year, month)
  where stripe_payment_intent_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Remember when check-in was opened, for meetings without explicit times
alter table public.attendance_meetings add column if not exists activated_at timestamptz;
