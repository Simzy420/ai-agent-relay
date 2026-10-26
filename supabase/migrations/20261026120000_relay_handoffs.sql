-- Shareable read-only handoffs for AI Agent Relay.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- You can run it again safely. It does not change relay_workspaces.

create table if not exists public.relay_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_name text not null default '',
  agent_name text not null default '',
  title text not null default '',
  status text not null default 'shared',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.relay_handoffs enable row level security;

drop policy if exists relay_handoffs_owner_select on public.relay_handoffs;
create policy relay_handoffs_owner_select
  on public.relay_handoffs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists relay_handoffs_owner_insert on public.relay_handoffs;
create policy relay_handoffs_owner_insert
  on public.relay_handoffs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists relay_handoffs_owner_delete on public.relay_handoffs;
create policy relay_handoffs_owner_delete
  on public.relay_handoffs
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Anyone who has the link can read that one handoff.
-- They cannot list other handoffs. The long id is the secret.
create or replace function public.get_relay_handoff(handoff_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', id,
    'project_name', project_name,
    'agent_name', agent_name,
    'title', title,
    'status', status,
    'payload', payload,
    'created_at', created_at
  )
  from public.relay_handoffs
  where id = handoff_id
$$;

revoke all on function public.get_relay_handoff(uuid) from public;
grant execute on function public.get_relay_handoff(uuid) to anon, authenticated;
