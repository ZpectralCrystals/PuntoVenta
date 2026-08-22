create table if not exists public.app_state (
  id smallint primary key check (id = 1),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_sessions (
  token_hash text primary key,
  user_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_expires_at_idx on public.auth_sessions (expires_at);

alter table public.app_state enable row level security;
alter table public.auth_sessions enable row level security;

revoke all on public.app_state, public.auth_sessions from anon, authenticated;
grant all on public.app_state, public.auth_sessions to service_role;
