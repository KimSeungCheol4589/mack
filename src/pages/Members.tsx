import { useMemo, useState } from 'react';
import { RoleBadge } from '../components/Layout';
import { ScoreGuide } from '../components/ScoreGuide';
import { WeeklyAttendance } from '../components/WeeklyAttendance';
import { WeeklyAwards } from '../components/WeeklySettlement';
import { api, fmt } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import type { Member } from '../lib/types';

type SortKey = 'combat_power' | 'growth_week' | 'activity_score' | 'points';

const SORTS: { key: SortKey; label: string; memberOnly?: boolean }[] = [
  { key: 'combat_power', label: '전투력순' },
  { key: 'growth_week', label: '성장순' },
  { key: 'activity_score', label: '활동 점수순', memberOnly: true },
  { key: 'points', label: '기여 점수순', memberOnly: true },
];

export function Members() {
  const { session, isMember, me } = useAuth();
  const members = useLoad(() => api.listMembers(), [session?.userId]);
  const guild = useLoad(() => api.getGuild());
  const ledger = useLoad(() => (isMember ? api.listLedger() : Promise.resolve([])), [isMember]);
  const [sort, setSort] = useState<SortKey>('combat_power');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim();
    return (members.data ?? [])
      .filter((m) => m.approved)
      .filter((m) => !q || m.nickname.includes(q))
      .sort((a: Member, b: Member) => b[sort] - a[sort]);
  }, [members.data, sort, query]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>문파원</h1>
        <p className="muted">전투력은 운영진이 매주 게임 문파원 목록 캡처로 갱신합니다. 주간 성장은 지난 주간 결산 이후 오른 양입니다.</p>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {SORTS.filter((s) => !s.memberOnly || isMember).map((s) => (
            <button key={s.key} role="tab" aria-selected={sort === s.key} className={sort === s.key ? 'tab active' : 'tab'} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <input className="input" placeholder="닉네임 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {members.error && <p className="error">{members.error}</p>}

      <WeeklyAwards />

      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>닉네임</th>
              <th>직책</th>
              <th className="r">전투력</th>
              <th className="r">주간 성장</th>
              <th className="r">전투력 점수</th>
              {isMember && <th className="r">활동 점수</th>}
              {isMember && <th className="r">기여 점수</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={m.id} className={m.id === me?.id ? 'me-row' : undefined}>
                <td>
                  <span className={`rank rank-${i + 1}`}>{i + 1}</span>
                </td>
                <td className="strong">{m.nickname}</td>
                <td>
                  <RoleBadge role={m.role} />
                </td>
                <td className="r num">{fmt(m.combat_power)}</td>
                <td className={`r num ${m.growth_week > 0 ? 'up' : 'muted'}`}>
                  {m.growth_week > 0 ? `▲ ${fmt(m.growth_week)}` : m.growth_week < 0 ? `▼ ${fmt(-m.growth_week)}` : '-'}
                </td>
                <td className="r num">{fmt(m.power_score)}</td>
                {isMember && <td className="r num">{fmt(m.activity_score)}</td>}
                {isMember && <td className="r num strong">{fmt(m.points)}</td>}
              </tr>
            ))}
            {members.data && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted center">
                  찾는 문파원이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!members.data && !members.error && <p className="muted center pad">불러오는 중…</p>}
      </div>
      {!isMember && <p className="muted small">활동 점수와 기여 점수는 로그인한 문파원에게만 보입니다.</p>}
      {isMember && members.data && ledger.data && <WeeklyAttendance members={members.data} ledger={ledger.data} />}
      {guild.data && <ScoreGuide guild={guild.data} />}
    </div>
  );
}
