create extension if not exists pgcrypto with schema extensions;

create table if not exists public.overreach_rooms_v2 (
  id text primary key,
  phase text not null default 'lobby'
    check (phase in ('lobby', 'countdown', 'select', 'reveal', 'gameover')),
  timer_enabled boolean not null default true,
  round smallint not null default 1 check (round between 1 and 9),
  p1_id text not null,
  p1_name text not null,
  p1_secret_hash text not null,
  p1_hand smallint[] not null default array[1,2,3,4,5,6,7,8,9]::smallint[],
  p1_card smallint,
  p1_score integer not null default 0,
  p1_wins smallint not null default 0,
  p1_last_seen timestamptz not null default now(),
  p2_id text,
  p2_name text,
  p2_secret_hash text,
  p2_hand smallint[] not null default array[1,2,3,4,5,6,7,8,9]::smallint[],
  p2_card smallint,
  p2_score integer not null default 0,
  p2_wins smallint not null default 0,
  p2_last_seen timestamptz,
  history jsonb not null default '[]'::jsonb,
  last_round jsonb,
  rematch_p1 boolean not null default false,
  rematch_p2 boolean not null default false,
  starts_at timestamptz,
  round_started_at timestamptz,
  reveal_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id ~ '^[A-HJ-NP-Z2-9]{6}$'),
  check (char_length(p1_name) between 1 and 18),
  check (p2_name is null or char_length(p2_name) between 1 and 18),
  check (p1_card is null or p1_card between 1 and 9),
  check (p2_card is null or p2_card between 1 and 9)
);

alter table public.overreach_rooms_v2 enable row level security;
revoke all on table public.overreach_rooms_v2 from anon, authenticated;

create or replace function public.overreach_secret_hash_v2(p_secret text)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(p_secret, 'sha256'), 'hex');
$$;

create or replace function public.overreach_room_view_v2(
  p_room_id text,
  p_player_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  seat text;
  secret_hash text;
begin
  select * into room
  from public.overreach_rooms_v2
  where id = upper(p_room_id);

  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;

  secret_hash := public.overreach_secret_hash_v2(p_player_secret);
  if room.p1_secret_hash = secret_hash then
    seat := 'p1';
  elsif room.p2_secret_hash = secret_hash then
    seat := 'p2';
  else
    raise exception 'invalid_room_secret' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'version', 2,
    'id', room.id,
    'seat', seat,
    'phase', room.phase,
    'timerEnabled', room.timer_enabled,
    'round', room.round,
    'startsAt', room.starts_at,
    'roundStartedAt', room.round_started_at,
    'revealUntil', room.reveal_until,
    'you', case when seat = 'p1' then jsonb_build_object(
      'name', room.p1_name,
      'score', room.p1_score,
      'wins', room.p1_wins,
      'hand', to_jsonb(room.p1_hand),
      'locked', room.p1_card is not null,
      'joined', true,
      'connected', true
    ) else jsonb_build_object(
      'name', room.p2_name,
      'score', room.p2_score,
      'wins', room.p2_wins,
      'hand', to_jsonb(room.p2_hand),
      'locked', room.p2_card is not null,
      'joined', true,
      'connected', true
    ) end,
    'opponent', case when seat = 'p1' then jsonb_build_object(
      'name', coalesce(room.p2_name, 'Waiting...'),
      'score', room.p2_score,
      'wins', room.p2_wins,
      'hand', to_jsonb(room.p2_hand),
      'locked', room.p2_card is not null,
      'joined', room.p2_id is not null,
      'connected', room.p2_last_seen is not null and room.p2_last_seen > now() - interval '6 seconds'
    ) else jsonb_build_object(
      'name', room.p1_name,
      'score', room.p1_score,
      'wins', room.p1_wins,
      'hand', to_jsonb(room.p1_hand),
      'locked', room.p1_card is not null,
      'joined', true,
      'connected', room.p1_last_seen > now() - interval '6 seconds'
    ) end,
    'history', room.history,
    'lastRound', room.last_round,
    'rematch', case when seat = 'p1' then jsonb_build_object(
      'you', room.rematch_p1,
      'opponent', room.rematch_p2
    ) else jsonb_build_object(
      'you', room.rematch_p2,
      'opponent', room.rematch_p1
    ) end
  );
end;
$$;

create or replace function public.overreach_resolve_room_v2(p_room_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  higher_player text;
  lower_player text;
  winner text;
  gap integer;
  did_overreach boolean;
  winning_card smallint;
  p1_points integer := 0;
  p2_points integer := 0;
  entry jsonb;
begin
  select * into room
  from public.overreach_rooms_v2
  where id = upper(p_room_id)
  for update;

  if not found or room.phase <> 'select' or room.p1_card is null or room.p2_card is null then
    return;
  end if;

  if room.p1_card = room.p2_card then
    higher_player := null;
    lower_player := null;
    winner := null;
    gap := 0;
    did_overreach := false;
    winning_card := null;
  else
    higher_player := case when room.p1_card > room.p2_card then 'p1' else 'p2' end;
    lower_player := case when higher_player = 'p1' then 'p2' else 'p1' end;
    gap := abs(room.p1_card - room.p2_card);
    did_overreach := gap > 4;
    winner := case when did_overreach then lower_player else higher_player end;
    winning_card := case when winner = 'p1' then room.p1_card else room.p2_card end;
    p1_points := case when winner = 'p1' then winning_card else 0 end;
    p2_points := case when winner = 'p2' then winning_card else 0 end;
  end if;

  entry := jsonb_build_object(
    'round', room.round,
    'p1Card', room.p1_card,
    'p2Card', room.p2_card,
    'result', jsonb_build_object(
      'winner', winner,
      'overreach', did_overreach,
      'gap', gap,
      'p1Points', p1_points,
      'p2Points', p2_points,
      'winningCard', winning_card,
      'higherPlayer', higher_player,
      'lowerPlayer', lower_player
    )
  );

  update public.overreach_rooms_v2
  set
    phase = case when room.round >= 9 then 'gameover' else 'reveal' end,
    p1_hand = array_remove(room.p1_hand, room.p1_card),
    p2_hand = array_remove(room.p2_hand, room.p2_card),
    p1_card = null,
    p2_card = null,
    p1_score = room.p1_score + p1_points,
    p2_score = room.p2_score + p2_points,
    p1_wins = room.p1_wins + case when winner = 'p1' then 1 else 0 end,
    p2_wins = room.p2_wins + case when winner = 'p2' then 1 else 0 end,
    history = jsonb_build_array(entry) || room.history,
    last_round = entry,
    round_started_at = null,
    reveal_until = case when room.round >= 9 then null else now() + interval '2.2 seconds' end,
    updated_at = now()
  where id = room.id;
end;
$$;

create or replace function public.overreach_progress_room_v2(p_room_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  timed_p1 smallint;
  timed_p2 smallint;
begin
  select * into room
  from public.overreach_rooms_v2
  where id = upper(p_room_id)
  for update;

  if not found then
    return;
  end if;

  if room.phase = 'countdown' and room.starts_at <= now() then
    update public.overreach_rooms_v2
    set phase = 'select', starts_at = null, round_started_at = now(), updated_at = now()
    where id = room.id;
    return;
  end if;

  if room.phase = 'reveal' and room.reveal_until <= now() then
    update public.overreach_rooms_v2
    set
      phase = 'select',
      round = least(9, room.round + 1),
      last_round = null,
      reveal_until = null,
      round_started_at = now(),
      updated_at = now()
    where id = room.id;
    return;
  end if;

  if room.phase = 'select'
    and room.timer_enabled
    and room.round_started_at + interval '15 seconds' <= now()
  then
    if room.p1_card is null then
      select card into timed_p1 from unnest(room.p1_hand) as card order by random() limit 1;
    else
      timed_p1 := room.p1_card;
    end if;

    if room.p2_card is null then
      select card into timed_p2 from unnest(room.p2_hand) as card order by random() limit 1;
    else
      timed_p2 := room.p2_card;
    end if;

    update public.overreach_rooms_v2
    set p1_card = timed_p1, p2_card = timed_p2, updated_at = now()
    where id = room.id;

    perform public.overreach_resolve_room_v2(room.id);
  end if;
end;
$$;

create or replace function public.overreach_create_room_v2(
  p_room_id text,
  p_player_id text,
  p_player_name text,
  p_player_secret text,
  p_timer_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room_id text := upper(trim(p_room_id));
  player_name text := left(trim(p_player_name), 18);
begin
  if room_id !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'invalid_room_code' using errcode = 'P0001';
  end if;
  if player_name = '' then
    raise exception 'invalid_player_name' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_player_id, '')) < 8 or char_length(coalesce(p_player_secret, '')) < 32 then
    raise exception 'invalid_player_credentials' using errcode = 'P0001';
  end if;

  delete from public.overreach_rooms_v2 where updated_at < now() - interval '24 hours';

  insert into public.overreach_rooms_v2 (
    id, timer_enabled, p1_id, p1_name, p1_secret_hash
  ) values (
    room_id,
    coalesce(p_timer_enabled, true),
    left(p_player_id, 100),
    player_name,
    public.overreach_secret_hash_v2(p_player_secret)
  );

  return public.overreach_room_view_v2(room_id, p_player_secret);
exception
  when unique_violation then
    raise exception 'room_code_taken' using errcode = '23505';
end;
$$;

create or replace function public.overreach_join_room_v2(
  p_room_id text,
  p_player_id text,
  p_player_name text,
  p_player_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  room_id text := upper(trim(p_room_id));
  player_name text := left(trim(p_player_name), 18);
  secret_hash text;
begin
  if player_name = '' then
    raise exception 'invalid_player_name' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_player_id, '')) < 8 or char_length(coalesce(p_player_secret, '')) < 32 then
    raise exception 'invalid_player_credentials' using errcode = 'P0001';
  end if;

  select * into room
  from public.overreach_rooms_v2
  where id = room_id
  for update;

  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;

  secret_hash := public.overreach_secret_hash_v2(p_player_secret);
  if room.p1_secret_hash = secret_hash then
    update public.overreach_rooms_v2
    set p1_name = player_name, p1_last_seen = now(), updated_at = now()
    where id = room.id;
    return public.overreach_room_view_v2(room.id, p_player_secret);
  end if;

  if room.p2_secret_hash = secret_hash then
    update public.overreach_rooms_v2
    set p2_name = player_name, p2_last_seen = now(), updated_at = now()
    where id = room.id;
    return public.overreach_room_view_v2(room.id, p_player_secret);
  end if;

  if room.p2_id is not null or room.phase <> 'lobby' then
    raise exception 'room_full' using errcode = 'P0001';
  end if;

  update public.overreach_rooms_v2
  set
    p2_id = left(p_player_id, 100),
    p2_name = player_name,
    p2_secret_hash = secret_hash,
    p2_last_seen = now(),
    phase = 'countdown',
    starts_at = now() + interval '3 seconds',
    updated_at = now()
  where id = room.id;

  return public.overreach_room_view_v2(room.id, p_player_secret);
end;
$$;

create or replace function public.overreach_get_room_v2(
  p_room_id text,
  p_player_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  secret_hash text;
begin
  select * into room
  from public.overreach_rooms_v2
  where id = upper(trim(p_room_id));

  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;

  secret_hash := public.overreach_secret_hash_v2(p_player_secret);
  if room.p1_secret_hash <> secret_hash and coalesce(room.p2_secret_hash, '') <> secret_hash then
    raise exception 'invalid_room_secret' using errcode = 'P0001';
  end if;

  perform public.overreach_progress_room_v2(room.id);

  if room.p1_secret_hash = secret_hash then
    update public.overreach_rooms_v2 set p1_last_seen = now() where id = room.id;
  else
    update public.overreach_rooms_v2 set p2_last_seen = now() where id = room.id;
  end if;

  return public.overreach_room_view_v2(room.id, p_player_secret);
end;
$$;

create or replace function public.overreach_play_card_v2(
  p_room_id text,
  p_player_secret text,
  p_card smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  seat text;
  secret_hash text;
begin
  if p_card < 1 or p_card > 9 then
    raise exception 'invalid_card' using errcode = 'P0001';
  end if;

  perform public.overreach_progress_room_v2(p_room_id);

  select * into room
  from public.overreach_rooms_v2
  where id = upper(trim(p_room_id))
  for update;

  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;

  secret_hash := public.overreach_secret_hash_v2(p_player_secret);
  if room.p1_secret_hash = secret_hash then seat := 'p1';
  elsif room.p2_secret_hash = secret_hash then seat := 'p2';
  else raise exception 'invalid_room_secret' using errcode = 'P0001';
  end if;

  if room.phase <> 'select' then
    raise exception 'round_not_selecting' using errcode = 'P0001';
  end if;

  if seat = 'p1' then
    if room.p1_card is not null then raise exception 'card_already_locked' using errcode = 'P0001'; end if;
    if not p_card = any(room.p1_hand) then raise exception 'card_not_in_hand' using errcode = 'P0001'; end if;
    update public.overreach_rooms_v2 set p1_card = p_card, p1_last_seen = now(), updated_at = now() where id = room.id;
  else
    if room.p2_card is not null then raise exception 'card_already_locked' using errcode = 'P0001'; end if;
    if not p_card = any(room.p2_hand) then raise exception 'card_not_in_hand' using errcode = 'P0001'; end if;
    update public.overreach_rooms_v2 set p2_card = p_card, p2_last_seen = now(), updated_at = now() where id = room.id;
  end if;

  select * into room from public.overreach_rooms_v2 where id = room.id;
  if room.p1_card is not null and room.p2_card is not null then
    perform public.overreach_resolve_room_v2(room.id);
  end if;

  return public.overreach_room_view_v2(room.id, p_player_secret);
end;
$$;

create or replace function public.overreach_rematch_v2(
  p_room_id text,
  p_player_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  seat text;
  secret_hash text;
begin
  select * into room
  from public.overreach_rooms_v2
  where id = upper(trim(p_room_id))
  for update;

  if not found then raise exception 'room_not_found' using errcode = 'P0001'; end if;
  secret_hash := public.overreach_secret_hash_v2(p_player_secret);
  if room.p1_secret_hash = secret_hash then seat := 'p1';
  elsif room.p2_secret_hash = secret_hash then seat := 'p2';
  else raise exception 'invalid_room_secret' using errcode = 'P0001';
  end if;
  if room.phase <> 'gameover' then raise exception 'match_not_complete' using errcode = 'P0001'; end if;

  update public.overreach_rooms_v2
  set
    rematch_p1 = case when seat = 'p1' then true else rematch_p1 end,
    rematch_p2 = case when seat = 'p2' then true else rematch_p2 end,
    updated_at = now()
  where id = room.id;

  select * into room from public.overreach_rooms_v2 where id = room.id for update;
  if room.rematch_p1 and room.rematch_p2 then
    update public.overreach_rooms_v2
    set
      phase = 'countdown',
      round = 1,
      p1_hand = array[1,2,3,4,5,6,7,8,9]::smallint[],
      p2_hand = array[1,2,3,4,5,6,7,8,9]::smallint[],
      p1_card = null,
      p2_card = null,
      p1_score = 0,
      p2_score = 0,
      p1_wins = 0,
      p2_wins = 0,
      history = '[]'::jsonb,
      last_round = null,
      rematch_p1 = false,
      rematch_p2 = false,
      starts_at = now() + interval '3 seconds',
      round_started_at = null,
      reveal_until = null,
      updated_at = now()
    where id = room.id;
  end if;

  return public.overreach_room_view_v2(room.id, p_player_secret);
end;
$$;

create or replace function public.overreach_leave_room_v2(
  p_room_id text,
  p_player_secret text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  room public.overreach_rooms_v2%rowtype;
  secret_hash text;
begin
  select * into room
  from public.overreach_rooms_v2
  where id = upper(trim(p_room_id))
  for update;

  if not found then return true; end if;
  secret_hash := public.overreach_secret_hash_v2(p_player_secret);
  if room.p1_secret_hash <> secret_hash and coalesce(room.p2_secret_hash, '') <> secret_hash then
    raise exception 'invalid_room_secret' using errcode = 'P0001';
  end if;

  delete from public.overreach_rooms_v2 where id = room.id;
  return true;
end;
$$;

revoke all on function public.overreach_secret_hash_v2(text) from public, anon, authenticated;
revoke all on function public.overreach_room_view_v2(text, text) from public, anon, authenticated;
revoke all on function public.overreach_resolve_room_v2(text) from public, anon, authenticated;
revoke all on function public.overreach_progress_room_v2(text) from public, anon, authenticated;

revoke all on function public.overreach_create_room_v2(text, text, text, text, boolean) from public;
revoke all on function public.overreach_join_room_v2(text, text, text, text) from public;
revoke all on function public.overreach_get_room_v2(text, text) from public;
revoke all on function public.overreach_play_card_v2(text, text, smallint) from public;
revoke all on function public.overreach_rematch_v2(text, text) from public;
revoke all on function public.overreach_leave_room_v2(text, text) from public;

grant execute on function public.overreach_create_room_v2(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.overreach_join_room_v2(text, text, text, text) to anon, authenticated;
grant execute on function public.overreach_get_room_v2(text, text) to anon, authenticated;
grant execute on function public.overreach_play_card_v2(text, text, smallint) to anon, authenticated;
grant execute on function public.overreach_rematch_v2(text, text) to anon, authenticated;
grant execute on function public.overreach_leave_room_v2(text, text) to anon, authenticated;

do $$
begin
  if to_regclass('public.overreach_rooms') is not null then
    execute 'drop policy if exists "overreach rooms are readable" on public.overreach_rooms';
    execute 'drop policy if exists "overreach rooms can be created" on public.overreach_rooms';
    execute 'drop policy if exists "overreach rooms can be updated" on public.overreach_rooms';
    execute 'revoke all on table public.overreach_rooms from anon, authenticated';

    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'overreach_rooms'
    ) then
      execute 'alter publication supabase_realtime drop table public.overreach_rooms';
    end if;
  end if;
end $$;

comment on table public.overreach_rooms_v2 is
  'Private two-player Overreach rooms. Clients can only interact through validated RPC functions.';
