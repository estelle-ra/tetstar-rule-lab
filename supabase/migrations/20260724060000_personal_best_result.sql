create or replace function public.submit_game_result(
  p_mode text,
  p_score bigint,
  p_time_ms integer,
  p_lines integer,
  p_won boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  previous_record public.mode_records%rowtype;
  saved_record public.mode_records%rowtype;
  is_personal_best boolean := false;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into previous_record
  from public.mode_records
  where user_id = player_id and mode = p_mode
  for update;

  if p_mode = 'sprint' then
    is_personal_best :=
      p_won
      and p_time_ms > 0
      and (
        previous_record.user_id is null
        or previous_record.best_time_ms is null
        or p_time_ms < previous_record.best_time_ms
      );
  else
    is_personal_best :=
      previous_record.user_id is null
      or p_score > previous_record.best_score;
  end if;

  perform public.record_game_result(
    p_mode,
    p_score,
    p_time_ms,
    p_lines,
    p_won
  );

  select *
  into saved_record
  from public.mode_records
  where user_id = player_id and mode = p_mode;

  return jsonb_build_object(
    'personal_best', is_personal_best,
    'mode', saved_record.mode,
    'best_score', saved_record.best_score,
    'best_time_ms', saved_record.best_time_ms,
    'best_lines', saved_record.best_lines,
    'wins', saved_record.wins,
    'level', (
      select level from public.profiles where id = player_id
    )
  );
end;
$$;

revoke all on function public.submit_game_result(
  text,
  bigint,
  integer,
  integer,
  boolean
) from public;

grant execute on function public.submit_game_result(
  text,
  bigint,
  integer,
  integer,
  boolean
) to authenticated;
