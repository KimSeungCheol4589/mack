-- =====================================================================
-- 002: 전투력은 운영진만 갱신 + 주간 전투력 결산 (최고 전투력·최고 성장 보너스)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 한 번 실행하세요.
-- =====================================================================

-- 주간 보너스 점수 (문주만 변경)
alter table public.guild
  add column weekly_bonus jsonb not null default '{"top_power": 20, "top_growth": 30}';

-- 점수 원장에 주간 보너스 종류 추가 (주 1회: activity_date = 결산한 주의 수요일)
alter table public.point_ledger drop constraint point_ledger_kind_check;
alter table public.point_ledger drop constraint point_ledger_check;
alter table public.point_ledger add constraint point_ledger_kind_check
  check (kind in ('yosin', 'barrier', 'garden', 'singi', 'top_power', 'top_growth', 'warehouse', 'adjust'));
alter table public.point_ledger add constraint point_ledger_check
  check ((kind in ('yosin', 'barrier', 'garden', 'singi', 'top_power', 'top_growth')) = (activity_date is not null));

-- 주간 결산: 그 주에 확정한 전투력 스냅샷
create table public.power_settlements (
  week        date primary key check (week = week_start(week)),
  settled_at  timestamptz not null default now(),
  settled_by  uuid references public.profiles default auth.uid()
);

create table public.power_settlement_rows (
  week        date not null references public.power_settlements on delete cascade,
  member_id   uuid not null references public.profiles on delete cascade,
  -- 비교 기준 전투력 (지난 결산 값, 없으면 그 주 전에 마지막으로 기록된 값). 기준이 없으면 null → 성장 보너스 대상 아님
  prev_power  bigint,
  power       bigint not null,
  primary key (week, member_id)
);

alter table public.power_settlements     enable row level security;
alter table public.power_settlement_rows enable row level security;
create policy settlements_read      on public.power_settlements     for select to anon, authenticated using (true);
create policy settlement_rows_read  on public.power_settlement_rows for select to anon, authenticated using (true);
grant select on public.power_settlements, public.power_settlement_rows to anon, authenticated;

-- 전투력은 운영진만 갱신 (스크린샷 일괄 갱신)
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.combat_power is distinct from old.combat_power and not is_officer() then
    raise exception '전투력은 운영진이 게임 화면으로 갱신합니다';
  end if;
  -- 운영진은 문주의 전투력은 갱신할 수 있지만, 닉네임·직책·승인은 바꿀 수 없음
  if old.role = 'master' and old.id <> auth.uid() and not is_master()
     and (new.nickname is distinct from old.nickname
          or new.role is distinct from old.role
          or new.approved is distinct from old.approved) then
    raise exception '문주 정보는 문주만 바꿀 수 있습니다';
  end if;
  if new.role is distinct from old.role and not is_master() then
    raise exception '직책 변경은 문주만 할 수 있습니다';
  end if;
  if new.approved is distinct from old.approved and not is_officer() then
    raise exception '가입 승인은 운영진만 할 수 있습니다';
  end if;
  if old.role = 'master' and (new.role <> 'master' or not new.approved)
     and not exists (select 1 from profiles where role = 'master' and approved and id <> old.id) then
    raise exception '문주가 최소 한 명은 있어야 합니다. 다른 사람을 먼저 문주로 지정하세요';
  end if;
  return new;
end $$;

create or replace function public.touch_guild() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_master()
     and (new.power_tiers is distinct from old.power_tiers
          or new.activity_points is distinct from old.activity_points
          or new.weekly_bonus is distinct from old.weekly_bonus) then
    raise exception '점수 기준은 문주만 바꿀 수 있습니다';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 이 주를 지금 결산하면 들어갈 값 (미리보기와 결산이 같은 계산을 씀)
create or replace function public.power_week_preview(p_week date)
returns table (member_id uuid, prev_power bigint, power bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
         coalesce(
           (select r.power from power_settlement_rows r
             where r.member_id = p.id and r.week < week_start(p_week)
             order by r.week desc limit 1),
           (select h.combat_power from power_history h
             where h.member_id = p.id and h.combat_power > 0
               and h.recorded_at < (week_start(p_week)::timestamp at time zone 'Asia/Seoul')
             order by h.recorded_at desc limit 1)),
         p.combat_power
    from profiles p
   where p.approved and p.combat_power > 0;
$$;

-- 주간 결산: 지금 전투력을 그 주 값으로 확정하고, 최고 전투력·최고 성장(동점은 모두)에게 보너스 지급
create or replace function public.settle_power_week(p_week date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week  date := week_start(p_week);
  v_bonus jsonb;
  v_label text;
  v_top   bigint;
  v_grow  bigint;
begin
  if not is_officer() then
    raise exception '운영진만 결산할 수 있습니다';
  end if;
  if v_week > week_start((now() at time zone 'Asia/Seoul')::date) then
    raise exception '아직 시작하지 않은 주입니다';
  end if;
  perform pg_advisory_xact_lock(45890);
  if exists (select 1 from power_settlements where week >= v_week) then
    raise exception '이미 결산한 주이거나, 더 최근 주가 결산되어 있습니다';
  end if;

  insert into power_settlements (week) values (v_week);
  insert into power_settlement_rows (week, member_id, prev_power, power)
    select v_week, x.member_id, x.prev_power, x.power from power_week_preview(v_week) x;

  select weekly_bonus into v_bonus from guild where id = 1;
  v_label := to_char(v_week, 'FMMM/FMDD') || ' 주';

  select max(r.power) into v_top from power_settlement_rows r where r.week = v_week;
  if coalesce((v_bonus ->> 'top_power')::int, 0) > 0 and v_top is not null then
    insert into point_ledger (member_id, delta, kind, reason, activity_date)
      select r.member_id, (v_bonus ->> 'top_power')::int, 'top_power',
             '주간 최고 전투력 ' || v_label || ' (' || to_char(r.power, 'FM999,999,999,999') || ')', v_week
        from power_settlement_rows r where r.week = v_week and r.power = v_top;
  end if;

  select max(r.power - r.prev_power) into v_grow
    from power_settlement_rows r where r.week = v_week and r.prev_power is not null;
  if coalesce((v_bonus ->> 'top_growth')::int, 0) > 0 and v_grow > 0 then
    insert into point_ledger (member_id, delta, kind, reason, activity_date)
      select r.member_id, (v_bonus ->> 'top_growth')::int, 'top_growth',
             '주간 최고 성장 ' || v_label || ' (+' || to_char(v_grow, 'FM999,999,999,999') || ')', v_week
        from power_settlement_rows r
       where r.week = v_week and r.prev_power is not null and r.power - r.prev_power = v_grow;
  end if;
end $$;

-- 가장 최근 결산 취소 (잘못 읽은 전투력으로 결산했을 때): 보너스도 함께 회수
create or replace function public.cancel_power_week(p_week date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_officer() then
    raise exception '운영진만 취소할 수 있습니다';
  end if;
  if not exists (select 1 from power_settlements where week = p_week)
     or exists (select 1 from power_settlements where week > p_week) then
    raise exception '가장 최근 결산만 취소할 수 있습니다';
  end if;
  delete from point_ledger where kind in ('top_power', 'top_growth') and activity_week = p_week;
  delete from power_settlements where week = p_week;
end $$;

revoke execute on function public.power_week_preview(date) from anon;
revoke execute on function public.settle_power_week(date) from anon;
revoke execute on function public.cancel_power_week(date) from anon;

-- 문파원 요약: '7일 성장' 대신 '주간 성장' (지난 결산 이후, 결산이 없으면 이번 주 시작 전 값 대비)
drop view public.member_overview;
create view public.member_overview with (security_invoker = on) as
select
  p.id,
  p.nickname,
  p.combat_power,
  p.role,
  p.approved,
  p.joined_at,
  power_score(p.combat_power) as power_score,
  coalesce((select sum(l.delta) from point_ledger l
             where l.member_id = p.id and l.kind <> 'warehouse'), 0)::bigint as activity_score,
  (power_score(p.combat_power)
    + coalesce((select sum(l.delta) from point_ledger l where l.member_id = p.id), 0))::bigint as points,
  (p.combat_power - coalesce(
    (select r.power from power_settlement_rows r
      where r.member_id = p.id order by r.week desc limit 1),
    (select h.combat_power from power_history h
      where h.member_id = p.id and h.combat_power > 0
        and h.recorded_at < (week_start((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul')
      order by h.recorded_at desc limit 1),
    p.combat_power))::bigint as growth_week,
  p.nickname_confirmed
from profiles p;

grant select on public.member_overview to anon, authenticated;
