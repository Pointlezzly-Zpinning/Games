create table if not exists public.overreach_rooms (
  id text primary key,
  state jsonb not null,
  rev integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.overreach_rooms enable row level security;

drop policy if exists "overreach rooms are readable" on public.overreach_rooms;
create policy "overreach rooms are readable"
on public.overreach_rooms
for select
using (true);

drop policy if exists "overreach rooms can be created" on public.overreach_rooms;
create policy "overreach rooms can be created"
on public.overreach_rooms
for insert
with check (true);

drop policy if exists "overreach rooms can be updated" on public.overreach_rooms;
create policy "overreach rooms can be updated"
on public.overreach_rooms
for update
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'overreach_rooms'
  ) then
    alter publication supabase_realtime add table public.overreach_rooms;
  end if;
end $$;
