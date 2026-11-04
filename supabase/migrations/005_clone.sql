-- 분신 참여: 요신·결계지 등 문파 콘텐츠에 분신으로만 참여한 횟수 (디코처럼 횟수만큼 점수)
-- Supabase SQL Editor 에서 한 번 실행하세요. (다시 실행해도 됩니다)

-- 콘텐츠 종류·횟수 검사를 새로 만듦 (기존 검사 이름은 설치 방법마다 달라서 내용으로 찾아 지움)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.activities'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%discord%'
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.activities add constraint activities_kind_check
  check (kind in ('yosin', 'barrier', 'singi', 'garden', 'clone', 'discord'));
alter table public.activities add constraint activities_count_check
  check (count between 1 and 50 and (kind in ('discord', 'clone') or count = 1));

alter table public.guild alter column activity_points
  set default '{"yosin": 1, "barrier": 1, "singi": 1, "garden": 1, "clone": 1, "discord": 1}';
update public.guild set activity_points = activity_points || '{"clone": 1}'
 where not activity_points ? 'clone';
