-- Attendance: meetings admins configure, and one record per accepted check-in.
-- "Unavailable" is not stored; it is derived from expected members with no record.

create table public.attendance_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 200),
  description text,
  location_name text,
  meeting_date date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 100 check (radius_m between 25 and 2000),
  is_active boolean not null default false,
  cancelled_at timestamptz,
  check_in_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_meetings_window_check
    check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create index attendance_meetings_meeting_date_idx
  on public.attendance_meetings (meeting_date);

-- Check-in only ever looks at active meetings
create index attendance_meetings_active_idx
  on public.attendance_meetings (meeting_date)
  where is_active;

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.attendance_meetings (id) on delete cascade,
  -- Named so PostgREST embeds can refer to it, as the pickup module does
  user_id uuid not null
    constraint attendance_records_user_id_profiles_fkey
    references public.profiles (id) on delete cascade,
  status text not null default 'attended',
  recorded_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_m real,
  distance_m real,
  validation_status text not null
    check (validation_status in ('geofence_verified', 'admin_override')),
  -- The API maps a violation of this to 409
  constraint attendance_records_meeting_user_key unique (meeting_id, user_id),
  constraint attendance_records_location_check check (
    validation_status <> 'geofence_verified'
    or (latitude is not null and longitude is not null and distance_m is not null)
  )
);

-- Lookups by meeting use the unique constraint, since meeting_id leads it
create index attendance_records_user_id_idx
  on public.attendance_records (user_id);

-- No policies: only the backend, using the service key, can read or write
alter table public.attendance_meetings enable row level security;
alter table public.attendance_records enable row level security;
