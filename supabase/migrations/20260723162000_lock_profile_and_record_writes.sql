revoke update on public.profiles from authenticated;
drop policy if exists "users update own profile" on public.profiles;

revoke insert, update on public.mode_records from authenticated;
drop policy if exists "users insert own records" on public.mode_records;
drop policy if exists "users update own records" on public.mode_records;

-- Profile and leaderboard writes will be exposed later through validated
-- server-side functions. Logged-in players can still read public profiles and
-- records, but cannot forge levels or best scores from the browser.
