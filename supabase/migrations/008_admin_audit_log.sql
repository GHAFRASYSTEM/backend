-- Audit trail of admin actions. auth.service.ts has been writing admin
-- sign-ins here, and opportunities.service.ts records create/update/publish/
-- close/archive, but the table was never created in the live project.

create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  -- Nullable so the trail survives if the admin's account is later deleted.
  admin_id    uuid
    constraint admin_audit_log_admin_id_profiles_fkey references public.profiles (id) on delete set null,
  action      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_admin_id_created_at_idx
  on public.admin_audit_log (admin_id, created_at desc);

alter table public.admin_audit_log enable row level security;
