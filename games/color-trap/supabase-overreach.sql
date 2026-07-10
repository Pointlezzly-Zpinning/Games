create table if not exists public.color_trap_rooms (
  id text primary key,
  state jsonb not null,
  rev integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.color_trap_room_secrets (
  room_id text primary key references public.color_trap_rooms(id) on delete cascade,
  p1_token_hash text not null,
  p2_token_hash text,
  created_at timestamptz not null default now()
);

create index if not exists color_trap_rooms_updated_at_idx
on public.color_trap_rooms (updated_at);

alter table public.color_trap_rooms enable row level security;
alter table public.color_trap_room_secrets enable row level security;

drop policy if exists "color trap rooms are readable" on public.color_trap_rooms;
drop policy if exists "color trap rooms can be created" on public.color_trap_rooms;
drop policy if exists "color trap rooms can be updated" on public.color_trap_rooms;
drop policy if exists "active color trap rooms are readable" on public.color_trap_rooms;

-- Realtime clients may read active public match state, but only the server API may write it.
create policy "active color trap rooms are readable"
on public.color_trap_rooms
for select
using (updated_at > now() - interval '24 hours');

revoke all on public.color_trap_rooms from anon, authenticated;
grant select (id, state, rev, updated_at)
on public.color_trap_rooms
to anon, authenticated;

-- Seat tokens live in a separate table and are never readable from a browser client.
revoke all on public.color_trap_room_secrets from anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'color_trap_rooms'
  ) then
    alter publication supabase_realtime add table public.color_trap_rooms;
  end if;
end $$;

create or replace function public.delete_expired_color_trap_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.color_trap_rooms
  where updated_at <= now() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_color_trap_rooms() from public, anon, authenticated;
