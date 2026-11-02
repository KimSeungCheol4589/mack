-- =====================================================================
-- 003: 문파원 명단(운영진 관리) + 문파 엽전으로 통일
--   * 홈페이지 가입 여부와 상관없이 운영진이 명단·전투력·참여를 관리합니다.
--   * 기여 점수·전투력 구간 점수·점수 원장은 없어지고, 주간 결산에서
--     그 주 문파 엽전을 참여 점수 비율로 분배 + 최고 전투력·최고 성장 보너스 엽전을 줍니다.
--   * 기존 점수 원장·전투력 기록·주간 결산·창고 신청 기록은 삭제됩니다 (창고 아이템은 유지).
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 한 번 실행하세요.
-- =====================================================================

-- 옛 구조 정리
drop view if exists public.member_overview;
drop function if exists public.power_week_preview(date);
drop function if exists public.settle_power_week(date);
drop function if exists public.cancel_power_week(date);
drop function if exists public.member_points(uuid);
drop function if exists public.power_score(bigint);
drop trigger if exists profiles_record_power on public.profiles;
drop function if exists public.record_power();
drop table if exists public.power_settlement_rows;
drop table if exists public.power_settlements;
drop table if exists public.point_ledger;
drop table if exists public.warehouse_requests;
drop table if exists public.power_history;
alter table public.profiles drop column combat_power;

alter table public.guild drop column power_tiers;
alter table public.guild alter column activity_points
  set default '{"yosin": 1, "barrier": 1, "singi": 1, "garden": 1, "discord": 1}';
alter table public.guild alter column weekly_bonus
  set default '{"top_power": 300, "top_growth": 300}';
-- 문파원 명단 (운영진 관리). profile_id 는 연결된 홈페이지 계정
create table public.roster (
  id            uuid primary key default gen_random_uuid(),
  nickname      text not null unique check (char_length(trim(nickname)) between 1 and 20),
  rank          text not null default '문파원' check (rank in ('문파장', '부문파장', '문파원')),
  combat_power  bigint not null default 0 check (combat_power >= 0),
  profile_id    uuid unique references public.profiles on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 전투력이 바뀔 때마다 기록 (첫 기록이 성장 비교의 기준값이 됨)
create table public.roster_power (
  id            bigint generated always as identity primary key,
  roster_id     uuid   not null references public.roster on delete cascade,
  combat_power  bigint not null,
  recorded_at   timestamptz not null default now()
);
create index roster_power_idx on public.roster_power (roster_id, recorded_at);

-- 콘텐츠 참여: 한 사람·한 콘텐츠·한 주에 한 줄. 디코만 count 가 1 보다 클 수 있음
create table public.activities (
  roster_id   uuid not null references public.roster on delete cascade,
  kind        text not null check (kind in ('yosin', 'barrier', 'singi', 'garden', 'discord')),
  week        date not null check (week = week_start(week)),
  count       int  not null check (count between 1 and 50 and (kind = 'discord' or count = 1)),
  updated_at  timestamptz not null default now(),
  primary key (roster_id, kind, week)
);

-- 엽전 원장: 분배(share)·보너스(top_*)는 결산 RPC 전용, 창고 사용(warehouse), 운영진 조정(adjust)
create table public.coin_ledger (
  id          bigint generated always as identity primary key,
  roster_id   uuid not null references public.roster on delete cascade,
  delta       int  not null check (delta <> 0),
  kind        text not null check (kind in ('share', 'top_power', 'top_growth', 'warehouse', 'adjust')),
  week        date check (week = week_start(week)),
  reason      text not null default '',
  created_by  uuid references public.profiles default auth.uid(),
  created_at  timestamptz not null default now(),
  check ((kind in ('share', 'top_power', 'top_growth')) = (week is not null))
);
create index coin_ledger_roster_idx on public.coin_ledger (roster_id);
create unique index coin_ledger_weekly_once on public.coin_ledger (roster_id, kind, week) where week is not null;

-- 주간 결산: 그 주 문파 엽전(pool)을 점수 비율로 나눈 기록
create table public.settlements (
  week          date primary key check (week = week_start(week)),
  pool          int  not null check (pool >= 0),
  total_points  int  not null,
  settled_at    timestamptz not null default now(),
  settled_by    uuid references public.profiles default auth.uid()
);

create table public.settlement_rows (
  week        date not null references public.settlements on delete cascade,
  roster_id   uuid not null references public.roster on delete cascade,
  -- 비교 기준 전투력 (지난 결산 값, 없으면 첫 기록). 없으면 null → 성장 보너스 대상 아님
  prev_power  bigint,
  power       bigint not null,
  points      int    not null,
  share       int    not null,
  primary key (week, roster_id)
);

create table public.warehouse_requests (
  id            uuid primary key default gen_random_uuid(),
  roster_id     uuid not null references public.roster on delete cascade,
  requested_by  uuid references public.profiles on delete set null default auth.uid(),
  item_id       uuid not null references public.warehouse_items on delete cascade,
  quantity      int  not null check (quantity > 0),
  total_cost    int  not null check (total_cost >= 0),
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note          text not null default '',
  decided_by    uuid references public.profiles,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index warehouse_requests_roster_idx on public.warehouse_requests (roster_id, status);

-- 내 계정에 연결된 명단 id
create or replace function public.my_roster_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from roster where profile_id = auth.uid() and active;
$$;

create or replace function public.coin_balance(p_roster uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0) from coin_ledger where roster_id = p_roster;
$$;

-- 성장 비교 기준 전투력: p_week 이전 마지막 결산 값, 없으면 0 이 아닌 첫 기록
create or replace function public.base_power(p_roster uuid, p_week date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.power from settlement_rows r
      where r.roster_id = p_roster and r.week < p_week
      order by r.week desc limit 1),
    (select h.combat_power from roster_power h
      where h.roster_id = p_roster and h.combat_power > 0
      order by h.recorded_at, h.id limit 1));
$$;

-- 계정 보호 (SQL Editor 처럼 로그인 사용자가 없는 경우는 통과)
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
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

-- 계정이 승인되면 같은 닉네임의 명단과 연결, 승인이 풀리면 연결 해제
create or replace function public.link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved then
    update roster set profile_id = null where profile_id = new.id;
  elsif not exists (select 1 from roster where profile_id = new.id) then
    update roster set profile_id = new.id
     where nickname = new.nickname and profile_id is null;
  end if;
  return new;
end $$;

create trigger profiles_link
  after insert or update of approved, nickname on public.profiles
  for each row execute function public.link_profile();

-- 명단을 추가하거나 닉네임을 고치면, 같은 닉네임의 승인된 계정과 연결
create or replace function public.link_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nickname := trim(new.nickname);
  if new.profile_id is null then
    select p.id into new.profile_id
      from profiles p
     where p.nickname = new.nickname and p.approved
       and not exists (select 1 from roster r where r.profile_id = p.id and r.id <> new.id);
  end if;
  return new;
end $$;

create trigger roster_link
  before insert or update of nickname on public.roster
  for each row execute function public.link_roster();

-- 전투력 변경 기록
create or replace function public.record_roster_power() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.combat_power is distinct from old.combat_power then
    insert into roster_power (roster_id, combat_power) values (new.id, new.combat_power);
  end if;
  return new;
end $$;

create trigger roster_record_power
  after insert or update of combat_power on public.roster
  for each row execute function public.record_roster_power();

create or replace function public.touch_activity() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger activities_touch
  before update on public.activities
  for each row execute function public.touch_activity();

-- 문파 정보 수정: 점수·보너스 기준은 문주만 바꿀 수 있습니다.
create or replace function public.touch_guild() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_master()
     and (new.activity_points is distinct from old.activity_points
          or new.weekly_bonus is distinct from old.weekly_bonus) then
    raise exception '점수·보너스 기준은 문주만 바꿀 수 있습니다';
  end if;
  new.updated_at := now();
  return new;
end $$;

create view public.roster_overview with (security_invoker = on) as
select
  m.id,
  m.nickname,
  m.rank,
  m.combat_power,
  m.active,
  m.profile_id,
  m.created_at,
  b.base as prev_power,
  (m.combat_power - coalesce(b.base, m.combat_power))::bigint as growth,
  coalesce((select sum(l.delta) from coin_ledger l where l.roster_id = m.id), 0)::bigint as coins,
  coalesce((select sum(l.delta) from coin_ledger l where l.roster_id = m.id and l.delta > 0), 0)::bigint as earned
from roster m
cross join lateral (select base_power(m.id, 'infinity'::date) as base) b;

grant select on public.roster_overview to anon, authenticated;

alter table public.roster             enable row level security;
alter table public.roster_power       enable row level security;
alter table public.activities         enable row level security;
alter table public.coin_ledger        enable row level security;
alter table public.settlements        enable row level security;
alter table public.settlement_rows    enable row level security;
alter table public.warehouse_items    enable row level security;
alter table public.warehouse_requests enable row level security;

-- 명단·전투력: 누구나 읽기, 운영진 관리
create policy roster_read   on public.roster for select to anon, authenticated using (true);
create policy roster_insert on public.roster for insert to authenticated with check (is_officer());
create policy roster_update on public.roster for update to authenticated
  using (is_officer()) with check (is_officer());
create policy roster_delete on public.roster for delete to authenticated using (is_officer());
create policy roster_power_read on public.roster_power for select to anon, authenticated using (true);

-- 참여 기록: 문파원 읽기, 운영진 기록
create policy activities_read   on public.activities for select to authenticated using (is_member());
create policy activities_insert on public.activities for insert to authenticated with check (is_officer());
create policy activities_update on public.activities for update to authenticated
  using (is_officer()) with check (is_officer());
create policy activities_delete on public.activities for delete to authenticated using (is_officer());

-- 엽전: 문파원 읽기, 운영진은 조정만 직접 기록 (분배·보너스·창고는 RPC 전용)
create policy coins_read   on public.coin_ledger for select to authenticated using (is_member());
create policy coins_insert on public.coin_ledger for insert to authenticated
  with check (is_officer() and kind = 'adjust');

-- 결산: 누구나 읽기 (쓰기는 RPC 전용)
create policy settlements_read     on public.settlements     for select to anon, authenticated using (true);
create policy settlement_rows_read on public.settlement_rows for select to anon, authenticated using (true);

-- 창고 신청: 본인(연결된 명단) 또는 운영진 읽기 (생성/처리는 RPC 전용)
create policy requests_read on public.warehouse_requests for select to authenticated
  using (roster_id = my_roster_id() or is_officer());

-- 이 주를 지금 결산하면 들어갈 값 (미리보기와 결산이 같은 계산을 씀)
create or replace function public.week_preview(p_week date)
returns table (roster_id uuid, prev_power bigint, power bigint, points int)
language sql stable security definer set search_path = public as $$
  select m.id,
         base_power(m.id, week_start(p_week)),
         m.combat_power,
         coalesce((select sum(a.count * coalesce((g.activity_points ->> a.kind)::int, 0))
                     from activities a, guild g
                    where g.id = 1 and a.roster_id = m.id and a.week = week_start(p_week)), 0)::int
    from roster m
   where m.active;
$$;

-- 주간 결산: 그 주 문파 엽전(p_pool)을 점수 비율로 분배(1전 미만 버림)하고,
-- 최고 전투력·최고 성장(동점은 모두)에게 보너스 엽전 지급
create or replace function public.settle_week(p_week date, p_pool int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week  date := week_start(p_week);
  v_bonus jsonb;
  v_label text;
  v_total int;
  v_top   bigint;
  v_grow  bigint;
begin
  if not is_officer() then
    raise exception '운영진만 결산할 수 있습니다';
  end if;
  if p_pool is null or p_pool < 0 then
    raise exception '이번 주 문파 엽전을 확인해 주세요';
  end if;
  if v_week > week_start((now() at time zone 'Asia/Seoul')::date) then
    raise exception '아직 시작하지 않은 주입니다';
  end if;
  perform pg_advisory_xact_lock(45890);
  if exists (select 1 from settlements where week >= v_week) then
    raise exception '이미 결산한 주이거나, 더 최근 주가 결산되어 있습니다';
  end if;

  create temp table _rows on commit drop as select * from week_preview(v_week);
  select coalesce(sum(points), 0) into v_total from _rows;

  insert into settlements (week, pool, total_points) values (v_week, p_pool, v_total);
  insert into settlement_rows (week, roster_id, prev_power, power, points, share)
    select v_week, r.roster_id, r.prev_power, r.power, r.points,
           case when v_total > 0 then (p_pool::bigint * r.points / v_total)::int else 0 end
      from _rows r;

  v_label := to_char(v_week, 'FMMM/FMDD') || ' 주';
  insert into coin_ledger (roster_id, delta, kind, week, reason)
    select r.roster_id, r.share, 'share', v_week, '주간 분배 ' || v_label || ' (' || r.points || '점)'
      from settlement_rows r where r.week = v_week and r.share > 0;

  select weekly_bonus into v_bonus from guild where id = 1;

  select max(r.power) into v_top from settlement_rows r where r.week = v_week and r.power > 0;
  if coalesce((v_bonus ->> 'top_power')::int, 0) > 0 and v_top is not null then
    insert into coin_ledger (roster_id, delta, kind, week, reason)
      select r.roster_id, (v_bonus ->> 'top_power')::int, 'top_power', v_week,
             '주간 최고 전투력 ' || v_label || ' (' || to_char(r.power, 'FM999,999,999,999') || ')'
        from settlement_rows r where r.week = v_week and r.power = v_top;
  end if;

  select max(r.power - r.prev_power) into v_grow
    from settlement_rows r where r.week = v_week and r.prev_power is not null;
  if coalesce((v_bonus ->> 'top_growth')::int, 0) > 0 and v_grow > 0 then
    insert into coin_ledger (roster_id, delta, kind, week, reason)
      select r.roster_id, (v_bonus ->> 'top_growth')::int, 'top_growth', v_week,
             '주간 최고 성장 ' || v_label || ' (+' || to_char(v_grow, 'FM999,999,999,999') || ')'
        from settlement_rows r
       where r.week = v_week and r.prev_power is not null and r.power - r.prev_power = v_grow;
  end if;
end $$;

-- 가장 최근 결산 취소 (잘못 입력했을 때): 분배·보너스 엽전도 함께 회수
create or replace function public.cancel_settlement(p_week date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_officer() then
    raise exception '운영진만 취소할 수 있습니다';
  end if;
  if not exists (select 1 from settlements where week = p_week)
     or exists (select 1 from settlements where week > p_week) then
    raise exception '가장 최근 결산만 취소할 수 있습니다';
  end if;
  delete from coin_ledger where kind in ('share', 'top_power', 'top_growth') and week = p_week;
  delete from settlements where week = p_week;
end $$;

-- ---------------------------------------------------------------------
-- 창고 RPC (엽전)
-- ---------------------------------------------------------------------

-- 아이템 신청: 사용 가능 엽전(잔액 - 대기 중 신청 합계)으로 검사
create or replace function public.request_item(p_item uuid, p_qty int, p_note text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_item    warehouse_items;
  v_roster  uuid := my_roster_id();
  v_pending bigint;
  v_id      uuid;
begin
  if not is_member() then
    raise exception '승인된 문파원만 신청할 수 있습니다';
  end if;
  if v_roster is null then
    raise exception '문파원 명단과 연결되지 않은 계정입니다. 운영진에게 연결을 요청하세요';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception '수량을 확인해 주세요';
  end if;

  select * into v_item from warehouse_items where id = p_item and active;
  if not found then
    raise exception '창고에 없는 아이템입니다';
  end if;
  if v_item.stock < p_qty then
    raise exception '창고 재고가 부족합니다';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_roster::text));
  select coalesce(sum(total_cost), 0) into v_pending
    from warehouse_requests where roster_id = v_roster and status = 'pending';
  if coin_balance(v_roster) - v_pending < v_item.cost * p_qty then
    raise exception '엽전이 부족합니다';
  end if;

  insert into warehouse_requests (roster_id, item_id, quantity, total_cost, note)
  values (v_roster, p_item, p_qty, v_item.cost * p_qty, coalesce(p_note, ''))
  returning id into v_id;
  return v_id;
end $$;

-- 신청 승인/반려 (운영진)
create or replace function public.decide_request(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r         warehouse_requests;
  v_stock   int;
  v_name    text;
begin
  if not is_officer() then
    raise exception '운영진만 처리할 수 있습니다';
  end if;

  select * into r from warehouse_requests where id = p_id for update;
  if not found or r.status <> 'pending' then
    raise exception '이미 처리된 신청입니다';
  end if;

  if p_approve then
    select stock, name into v_stock, v_name from warehouse_items where id = r.item_id for update;
    if v_stock < r.quantity then
      raise exception '창고 재고가 부족합니다';
    end if;
    if coin_balance(r.roster_id) < r.total_cost then
      raise exception '신청자의 엽전이 부족합니다';
    end if;

    update warehouse_items set stock = stock - r.quantity where id = r.item_id;
    if r.total_cost > 0 then
      insert into coin_ledger (roster_id, delta, kind, reason, created_by)
      values (r.roster_id, -r.total_cost, 'warehouse', v_name || ' x' || r.quantity, auth.uid());
    end if;
  end if;

  update warehouse_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_id;
end $$;

-- 내 신청 취소
create or replace function public.cancel_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update warehouse_requests
     set status = 'cancelled', decided_at = now()
   where id = p_id and roster_id = my_roster_id() and status = 'pending';
  if not found then
    raise exception '취소할 수 없는 신청입니다';
  end if;
end $$;

revoke execute on function public.week_preview(date) from anon;
revoke execute on function public.settle_week(date, int) from anon;
revoke execute on function public.cancel_settlement(date) from anon;
revoke execute on function public.request_item(uuid, int, text) from anon;
revoke execute on function public.decide_request(uuid, boolean) from anon;
revoke execute on function public.cancel_request(uuid) from anon;

-- 참여 점수 1점씩, 보너스 300전
update public.guild set
  activity_points = '{"yosin": 1, "barrier": 1, "singi": 1, "garden": 1, "discord": 1}',
  weekly_bonus = '{"top_power": 300, "top_growth": 300}'
 where id = 1;

-- 기존 계정과 명단 연결은 명단을 넣을 때 자동으로 됩니다 (같은 닉네임)

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
