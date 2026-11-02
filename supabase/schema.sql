-- =====================================================================
-- 도깨비의세계 문파 홈페이지 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 한 번 실행하세요.
-- (이미 운영 중인 DB 는 이 파일 대신 supabase/migrations/ 의 새 파일만 실행)
--
-- 규칙 요약
--   * 홈페이지 계정(profiles)은 구글 로그인으로 만들어집니다. 첫 가입자는 자동으로
--     문주(master) + 승인, 이후 가입자는 운영진(문주·부문주)이 승인합니다.
--   * 문파원 명단(roster)은 운영진이 관리합니다. 홈페이지에 가입하지 않은 문파원도 명단에 있고,
--     같은 닉네임의 계정이 승인되면 자동으로 연결됩니다.
--   * 화폐는 문파 엽전 하나입니다.
--     - 콘텐츠 참여 점수: 요신 토벌령·결계지 방어·신기 쟁탈전·미혹의 정원 주 1회, 디코는 참여 횟수만큼
--     - 매주(수요일 시작) 결산: 그 주 문파 엽전을 점수 비율대로 분배(1전 미만 버림),
--       최고 전투력·최고 성장(지난 결산 대비)에게 보너스 엽전
--     - 문파창고 물품은 엽전으로 신청하고, 운영진이 승인하면 재고와 엽전이 차감됩니다.
-- =====================================================================

create extension if not exists pgcrypto;

-- 문파 콘텐츠 주간 시작일 (수요일 초기화): 그 날짜가 속한 주의 수요일
create or replace function public.week_start(d date) returns date
language sql immutable as $$
  select d - ((extract(isodow from d)::int + 4) % 7);
$$;

-- ---------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------

create table public.guild (
  id          int primary key default 1 check (id = 1),
  name        text    not null default '우리 문파',
  level       int     not null default 1 check (level >= 1),
  motto       text    not null default '',
  notice      text    not null default '',
  recruiting  boolean not null default true,
  -- 콘텐츠 1회 참여 점수 (디코는 횟수만큼)
  activity_points jsonb not null default '{"yosin": 1, "barrier": 1, "singi": 1, "garden": 1, "discord": 1}',
  -- 주간 결산 보너스 엽전: 최고 전투력, 최고 성장
  weekly_bonus jsonb not null default '{"top_power": 300, "top_growth": 300}',
  updated_at  timestamptz not null default now()
);
insert into public.guild (id) values (1);

-- 홈페이지 계정
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  nickname      text   not null unique check (char_length(nickname) between 1 and 20),
  role          text   not null default 'member' check (role in ('master', 'officer', 'member')),
  approved      boolean not null default false,
  joined_at     timestamptz not null default now(),
  -- 구글 가입은 게임 닉네임을 모르므로, 본인이 처음 닉네임을 정하면 true
  nickname_confirmed boolean not null default false
);

-- ---------------------------------------------------------------------
-- 문파원 명단 · 콘텐츠 참여 · 엽전 · 주간 결산
-- ---------------------------------------------------------------------

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

-- 문파창고
create table public.warehouse_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null default '기타',
  icon         text not null default '📦',
  description  text not null default '',
  stock        int  not null default 0 check (stock >= 0),
  cost         int  not null default 0 check (cost >= 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
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

-- ---------------------------------------------------------------------
-- 권한 헬퍼
-- ---------------------------------------------------------------------

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved);
$$;

create or replace function public.is_officer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and approved and role in ('master', 'officer'));
$$;

create or replace function public.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved and role = 'master');
$$;

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

-- ---------------------------------------------------------------------
-- 트리거
-- ---------------------------------------------------------------------

-- 회원가입(구글 로그인 포함) 시 계정 생성. 첫 가입자는 문주.
--   임시 닉네임은 구글 이름 → 이메일 앞부분 순서로 정하고, 겹치면 뒤에 숫자를 붙입니다.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first boolean;
  v_base  text;
  v_nick  text;
  v_n     int := 0;
begin
  perform pg_advisory_xact_lock(4589);
  select not exists (select 1 from profiles) into v_first;
  v_base := left(coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    '문파원'), 16);
  v_nick := v_base;
  while exists (select 1 from profiles where nickname = v_nick) loop
    v_n := v_n + 1;
    v_nick := v_base || v_n;
  end loop;
  insert into profiles (id, nickname, role, approved)
  values (new.id, v_nick, case when v_first then 'master' else 'member' end, v_first);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile();

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

create trigger guild_touch
  before update on public.guild
  for each row execute function public.touch_guild();

-- ---------------------------------------------------------------------
-- 문파원 요약 뷰: 지난 결산 대비 성장, 보유·누적 엽전
--   security_invoker: 보는 사람 권한으로 계산되므로 비로그인 방문자에게는 엽전이 0 으로 보입니다.
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- 행 수준 보안 (RLS)
-- ---------------------------------------------------------------------

alter table public.guild              enable row level security;
alter table public.profiles           enable row level security;
alter table public.roster             enable row level security;
alter table public.roster_power       enable row level security;
alter table public.activities         enable row level security;
alter table public.coin_ledger        enable row level security;
alter table public.settlements        enable row level security;
alter table public.settlement_rows    enable row level security;
alter table public.warehouse_items    enable row level security;
alter table public.warehouse_requests enable row level security;

-- 문파 정보: 누구나 읽기, 운영진 수정
create policy guild_read   on public.guild for select to anon, authenticated using (true);
create policy guild_update on public.guild for update to authenticated
  using (is_officer()) with check (is_officer());

-- 계정: 비로그인은 승인된 계정만, 로그인 사용자는 전체 / 본인 또는 운영진 수정
create policy profiles_read_public on public.profiles for select to anon using (approved);
create policy profiles_read_auth   on public.profiles for select to authenticated using (true);
create policy profiles_update      on public.profiles for update to authenticated
  using (id = auth.uid() or is_officer()) with check (id = auth.uid() or is_officer());

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

-- 창고 아이템: 문파원 읽기, 운영진 관리
create policy items_read   on public.warehouse_items for select to authenticated using (is_member());
create policy items_insert on public.warehouse_items for insert to authenticated with check (is_officer());
create policy items_update on public.warehouse_items for update to authenticated
  using (is_officer()) with check (is_officer());

-- 창고 신청: 본인(연결된 명단) 또는 운영진 읽기 (생성/처리는 RPC 전용)
create policy requests_read on public.warehouse_requests for select to authenticated
  using (roster_id = my_roster_id() or is_officer());

-- ---------------------------------------------------------------------
-- 주간 결산 RPC
-- ---------------------------------------------------------------------

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

-- =====================================================================
-- 도술덱 · 방명록 · 방문자 수
-- =====================================================================

-- 도술덱 (도술 8칸 + 궁극기 1칸): 문파원 누구나 올리고, 운영진이 '문파 추천'으로 표시
create table public.decks (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null default auth.uid() references public.profiles on delete cascade,
  title        text not null check (char_length(title) between 1 and 40),
  purpose      text not null default '사냥' check (purpose in ('사냥', '보스', '대인', '범용')),
  -- 칸 순서대로 도술 이름 (빈 칸은 null), 8칸
  slots        jsonb not null default '[]'
               check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 8),
  -- 궁극기 칸: 같은 스타일 도술 3개 이상인 스타일 중 고른 것 (없으면 null)
  ultimate_style text,
  description  text not null default '' check (char_length(description) <= 2000),
  video_url    text not null default '' check (video_url = '' or video_url ~ '^https?://'),
  guild_pick   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index decks_created_idx on public.decks (created_at desc);

-- 문파원의 '추천' (한 사람이 덱마다 한 번)
create table public.deck_likes (
  deck_id     uuid not null references public.decks on delete cascade,
  member_id   uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (deck_id, member_id)
);

-- '문파 추천' 표시는 운영진만, 작성자는 바꿀 수 없음
create or replace function public.guard_deck() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_officer() then
    if tg_op = 'INSERT' and new.guild_pick then
      raise exception '문파 추천은 운영진만 지정할 수 있습니다';
    end if;
    if tg_op = 'UPDATE' and new.guild_pick is distinct from old.guild_pick then
      raise exception '문파 추천은 운영진만 지정할 수 있습니다';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    -- 추천 표시만 바꾼 경우에는 수정 시각을 그대로 둠
    if (new.title, new.purpose, new.ultimate_style, new.slots, new.description, new.video_url)
       is distinct from (old.title, old.purpose, old.ultimate_style, old.slots, old.description, old.video_url) then
      new.updated_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger decks_guard
  before insert or update on public.decks
  for each row execute function public.guard_deck();

create view public.deck_overview with (security_invoker = on) as
select
  d.*,
  p.nickname as author_nickname,
  (select count(*) from deck_likes l where l.deck_id = d.id)::int as like_count,
  exists (select 1 from deck_likes l where l.deck_id = d.id and l.member_id = auth.uid()) as liked_by_me
from decks d
left join profiles p on p.id = d.author_id;

grant select on public.deck_overview to anon, authenticated;

alter table public.decks      enable row level security;
alter table public.deck_likes enable row level security;

create policy decks_read   on public.decks for select to anon, authenticated using (true);
create policy decks_insert on public.decks for insert to authenticated
  with check (is_member() and author_id = auth.uid());
create policy decks_update on public.decks for update to authenticated
  using (author_id = auth.uid() or is_officer()) with check (author_id = auth.uid() or is_officer());
create policy decks_delete on public.decks for delete to authenticated
  using (author_id = auth.uid() or is_officer());

create policy likes_read   on public.deck_likes for select to anon, authenticated using (true);
create policy likes_insert on public.deck_likes for insert to authenticated
  with check (is_member() and member_id = auth.uid());
create policy likes_delete on public.deck_likes for delete to authenticated
  using (member_id = auth.uid());

-- 방명록: 로그인하지 않은 방문자도 이름을 적어 남길 수 있음
create table public.guestbook (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid default auth.uid() references public.profiles on delete set null,
  name        text not null check (char_length(trim(name)) between 1 and 20),
  message     text not null check (char_length(trim(message)) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index guestbook_created_idx on public.guestbook (created_at desc);

-- 도배 방지: 같은 이름으로 30초 안에 다시 쓰지 못함
create or replace function public.guard_guestbook() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from guestbook
              where name = new.name and created_at > now() - interval '30 seconds') then
    raise exception '잠시 후 다시 남겨 주세요';
  end if;
  return new;
end $$;

create trigger guestbook_guard
  before insert on public.guestbook
  for each row execute function public.guard_guestbook();

alter table public.guestbook enable row level security;
create policy guestbook_read   on public.guestbook for select to anon, authenticated using (true);
create policy guestbook_insert on public.guestbook for insert to anon, authenticated
  with check (author_id is null or author_id = auth.uid());
create policy guestbook_delete on public.guestbook for delete to authenticated
  using (author_id = auth.uid() or is_officer());

-- 방문자 수: 브라우저마다 만든 임의의 id 로 하루 한 번만 셉니다 (개인정보는 저장하지 않음)
create table public.site_visits (
  day      date not null default (now() at time zone 'Asia/Seoul')::date,
  visitor  uuid not null,
  primary key (day, visitor)
);
alter table public.site_visits enable row level security;  -- 정책 없음: 아래 함수로만 접근

create or replace function public.record_visit(p_visitor uuid) returns void
language sql security definer set search_path = public as $$
  insert into site_visits (visitor) values (p_visitor) on conflict do nothing;
$$;

create or replace function public.visit_stats() returns table (today bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where day = (now() at time zone 'Asia/Seoul')::date), count(*)
    from site_visits;
$$;

grant execute on function public.record_visit(uuid) to anon, authenticated;
grant execute on function public.visit_stats() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 웹사이트(anon·authenticated)가 표에 접근할 수 있게 허용
--   실제로 누가 무엇을 보고 바꿀 수 있는지는 위의 RLS 정책과 함수가 정합니다.
--   (Supabase 프로젝트 설정에 따라 기본 권한이 없을 수 있어 명시합니다)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
