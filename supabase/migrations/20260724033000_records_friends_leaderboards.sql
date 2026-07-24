alter table public.mode_records
  alter column best_score set default 0,
  add column if not exists best_lines integer not null default 0
    check (best_lines >= 0),
  add column if not exists wins integer not null default 0
    check (wins >= 0);

update public.mode_records
set best_score = coalesce(best_score, 0);

alter table public.mode_records
  alter column best_score set not null;

create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_low, user_high),
  constraint friendships_distinct_users check (user_low <> user_high),
  constraint friendships_canonical_order check (
    user_low::text < user_high::text
  ),
  constraint friendships_requester_is_participant check (
    requested_by = user_low or requested_by = user_high
  )
);

alter table public.friendships enable row level security;
revoke all on public.friendships from public, anon, authenticated;
grant select on public.friendships to authenticated;

drop policy if exists "participants read friendships" on public.friendships;
create policy "participants read friendships"
on public.friendships for select
to authenticated
using (
  (select auth.uid()) = user_low
  or (select auth.uid()) = user_high
);

drop policy if exists "records readable after login" on public.mode_records;
drop policy if exists "records readable by player or friends"
  on public.mode_records;
create policy "records readable by player or friends"
on public.mode_records for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.friendships
    where status = 'accepted'
      and (
        (
          user_low = (select auth.uid())
          and user_high = mode_records.user_id
        )
        or (
          user_high = (select auth.uid())
          and user_low = mode_records.user_id
        )
      )
  )
);

create or replace function public.record_game_result(
  p_mode text,
  p_score bigint,
  p_time_ms integer,
  p_lines integer,
  p_won boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  earned_xp bigint;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_mode not in ('sprint', 'blitz', 'zen', 'versus') then
    raise exception 'INVALID_MODE';
  end if;
  if p_score < 0 or p_score > 1000000000000 then
    raise exception 'INVALID_SCORE';
  end if;
  if p_time_ms < 0 or p_time_ms > 86400000 then
    raise exception 'INVALID_TIME';
  end if;
  if p_lines < 0 or p_lines > 100000 then
    raise exception 'INVALID_LINES';
  end if;
  if p_mode = 'sprint' and p_won and p_lines < 40 then
    raise exception 'INVALID_SPRINT_RESULT';
  end if;

  insert into public.mode_records (
    user_id,
    mode,
    best_score,
    best_time_ms,
    best_lines,
    wins,
    games_played,
    updated_at
  )
  values (
    player_id,
    p_mode,
    p_score,
    case
      when p_mode = 'sprint' and p_won and p_time_ms > 0 then p_time_ms
      else null
    end,
    p_lines,
    case when p_won then 1 else 0 end,
    1,
    now()
  )
  on conflict (user_id, mode) do update
  set
    best_score = greatest(
      public.mode_records.best_score,
      excluded.best_score
    ),
    best_time_ms = case
      when excluded.best_time_ms is null
        then public.mode_records.best_time_ms
      when public.mode_records.best_time_ms is null
        then excluded.best_time_ms
      else least(
        public.mode_records.best_time_ms,
        excluded.best_time_ms
      )
    end,
    best_lines = greatest(
      public.mode_records.best_lines,
      excluded.best_lines
    ),
    wins = public.mode_records.wins + excluded.wins,
    games_played = public.mode_records.games_played + 1,
    updated_at = now();

  earned_xp := least(
    500::bigint,
    20
      + least(p_lines, 100) * 3
      + least(p_score / 1000, 100)
      + case when p_won then 50 else 0 end
  );

  update public.profiles
  set
    experience = experience + earned_xp,
    level = 1 + floor(
      sqrt((experience + earned_xp)::numeric / 500)
    )::integer,
    updated_at = now()
  where id = player_id;
end;
$$;

create or replace function public.send_friend_request(p_username text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_id uuid := auth.uid();
  target_id uuid;
  low_id uuid;
  high_id uuid;
  existing public.friendships;
begin
  if sender_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id into target_id
  from public.profiles
  where username_normalized = public.normalize_username(p_username);

  if target_id is null then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if target_id = sender_id then
    raise exception 'CANNOT_FRIEND_SELF';
  end if;

  low_id := least(sender_id::text, target_id::text)::uuid;
  high_id := greatest(sender_id::text, target_id::text)::uuid;

  select * into existing
  from public.friendships
  where user_low = low_id and user_high = high_id
  for update;

  if existing.id is not null then
    if existing.status = 'accepted' then
      raise exception 'ALREADY_FRIENDS';
    end if;
    if existing.requested_by <> sender_id then
      update public.friendships
      set status = 'accepted', updated_at = now()
      where id = existing.id;
    end if;
    return existing.id;
  end if;

  insert into public.friendships (
    user_low,
    user_high,
    requested_by
  )
  values (low_id, high_id, sender_id)
  returning id into existing.id;

  return existing.id;
end;
$$;

create or replace function public.respond_friend_request(
  p_request_id bigint,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  request public.friendships;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into request
  from public.friendships
  where id = p_request_id
    and status = 'pending'
    and requested_by <> player_id
    and (user_low = player_id or user_high = player_id)
  for update;

  if request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if p_accept then
    update public.friendships
    set status = 'accepted', updated_at = now()
    where id = request.id;
  else
    delete from public.friendships where id = request.id;
  end if;
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  low_id uuid;
  high_id uuid;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_friend_id = player_id then
    raise exception 'INVALID_FRIEND';
  end if;

  low_id := least(player_id::text, p_friend_id::text)::uuid;
  high_id := greatest(player_id::text, p_friend_id::text)::uuid;

  delete from public.friendships
  where user_low = low_id and user_high = high_id;
end;
$$;

revoke all on function public.record_game_result(
  text,
  bigint,
  integer,
  integer,
  boolean
) from public;
revoke all on function public.send_friend_request(text) from public;
revoke all on function public.respond_friend_request(bigint, boolean) from public;
revoke all on function public.remove_friend(uuid) from public;

grant execute on function public.record_game_result(
  text,
  bigint,
  integer,
  integer,
  boolean
) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(bigint, boolean)
  to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
