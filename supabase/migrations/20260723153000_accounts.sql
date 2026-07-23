create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.normalize_username(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(input, '')), '\s+', '_', 'g'));
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text not null unique,
  level integer not null default 1 check (level >= 1),
  experience bigint not null default 0 check (experience >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username_normalized ~ '^[a-z0-9가-힣_-]{2,16}$'
  )
);

create table if not exists public.account_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username_normalized text not null unique,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mode_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('sprint', 'blitz', 'zen', 'versus')),
  best_score bigint,
  best_time_ms integer,
  games_played integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

alter table public.profiles enable row level security;
alter table public.account_directory enable row level security;
alter table public.mode_records enable row level security;

revoke all on public.account_directory from public, anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.mode_records to authenticated;

drop policy if exists "profiles readable after login" on public.profiles;
create policy "profiles readable after login"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "records readable after login" on public.mode_records;
create policy "records readable after login"
on public.mode_records for select
to authenticated
using (true);

drop policy if exists "users insert own records" on public.mode_records;
create policy "users insert own records"
on public.mode_records for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own records" on public.mode_records;
create policy "users update own records"
on public.mode_records for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text;
begin
  normalized := public.normalize_username(new.raw_user_meta_data ->> 'username');

  if normalized !~ '^[a-z0-9가-힣_-]{2,16}$' then
    raise exception 'INVALID_USERNAME';
  end if;

  insert into public.profiles (id, username, username_normalized)
  values (new.id, normalized, normalized);

  insert into public.account_directory (
    user_id,
    username_normalized,
    email
  )
  values (new.id, normalized, lower(new.email));

  return new;
exception
  when unique_violation then
    raise exception 'USERNAME_TAKEN';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.normalize_username(candidate) ~ '^[a-z0-9가-힣_-]{2,16}$'
    and not exists (
      select 1
      from public.account_directory
      where username_normalized = public.normalize_username(candidate)
    );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;
