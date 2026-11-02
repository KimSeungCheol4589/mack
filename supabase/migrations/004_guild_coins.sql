-- 004: 게임의 문파 엽전 보유량을 기록하고, 결산 때 그 값을 남겨 다음 결산에서 차액을 분배 엽전으로 씁니다.
-- Supabase SQL Editor 에서 한 번 실행합니다.

alter table public.guild
  add column coins    bigint not null default 0 check (coins >= 0),
  add column coins_at timestamptz;

alter table public.settlements add column guild_coins bigint;

create or replace function public.touch_guild() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_master()
     and (new.activity_points is distinct from old.activity_points
          or new.weekly_bonus is distinct from old.weekly_bonus) then
    raise exception '점수·보너스 기준은 문주만 바꿀 수 있습니다';
  end if;
  if new.coins is distinct from old.coins then
    new.coins_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 결산할 때 그 시점의 문파 엽전 보유량을 남김 (입력한 적이 없으면 비움)
create or replace function public.settlement_guild_coins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select case when coins_at is null then null else coins end into new.guild_coins from guild where id = 1;
  return new;
end $$;

create trigger settlements_guild_coins
  before insert on public.settlements
  for each row execute function public.settlement_guild_coins();
