import { useMemo, useState } from 'react';
import { api, fmt } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useLoad } from '../lib/hooks';
import { ACTIVITIES, RANKS, activityPoints, type ActivityKey, type Rank, type RosterMember, type WeekActivities } from '../lib/types';
import { addDays, today, weekLabel, weekStart } from '../lib/week';

type SortKey = 'rank' | 'combat_power' | 'growth' | 'points' | 'earned' | 'coins';

const SORTS: { key: SortKey; label: string; memberOnly?: boolean }[] = [
  { key: 'rank', label: '직위순' },
  { key: 'combat_power', label: '전투력순' },
  { key: 'growth', label: '성장순' },
  { key: 'points', label: '이번 주 점수순', memberOnly: true },
  { key: 'earned', label: '누적엽전순', memberOnly: true },
];

const rankOrder = (r: RosterMember) => RANKS.indexOf(r.rank);

/**
 * 엑셀 '문파상점' 시트처럼 한눈에 보는 문파원 표: 직위·닉네임·전/현 전투력·성장·주간 참여·점수·엽전.
 * editable 이면 운영진이 칸을 눌러 참여를 기록합니다 (디코는 횟수).
 */
export function RosterSheet({ editable = false, onChanged }: { editable?: boolean; onChanged?: () => void }) {
  const { session, isMember, myRoster } = useAuth();
  const current = weekStart(today());
  const [week, setWeek] = useState(current);
  const roster = useLoad(() => api.listRoster(), [session?.userId]);
  const guild = useLoad(() => api.getGuild());
  const acts = useLoad(() => (isMember ? api.listActivities(week) : Promise.resolve({} as WeekActivities)), [week, isMember]);
  const [local, setLocal] = useState<WeekActivities>({});
  const [sort, setSort] = useState<SortKey>('rank');
  const [query, setQuery] = useState('');
  const { run } = useAction();

  // 서버 값 위에 방금 누른 값을 덮어서 바로 보여 줌
  const merged: WeekActivities = useMemo(() => {
    const out: WeekActivities = { ...(acts.data ?? {}) };
    for (const [id, v] of Object.entries(local)) out[id] = { ...out[id], ...v };
    return out;
  }, [acts.data, local]);
  const pts = guild.data?.activity_points;
  const pointsOf = (id: string) => (pts ? activityPoints(merged[id], pts) : 0);

  const rows = useMemo(() => {
    const q = query.trim();
    const list = (roster.data ?? []).filter((m) => m.active || editable).filter((m) => !q || m.nickname.includes(q));
    const key = (m: RosterMember): number =>
      sort === 'rank' ? -rankOrder(m) * 1e15 + m.combat_power : sort === 'points' ? pointsOf(m.id) * 1e13 + m.combat_power : m[sort];
    return list.sort((a, b) => key(b) - key(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.data, sort, query, merged, editable]);

  async function setCount(m: RosterMember, kind: ActivityKey, count: number) {
    const prev = merged[m.id]?.[kind] ?? 0;
    setLocal((l) => ({ ...l, [m.id]: { ...l[m.id], [kind]: count } }));
    const ok = await run(() => api.setActivity(m.id, kind, week, count));
    if (!ok) setLocal((l) => ({ ...l, [m.id]: { ...l[m.id], [kind]: prev } }));
    else onChanged?.();
  }

  const changeWeek = (w: string) => {
    setLocal({});
    setWeek(w);
  };
  const showActs = isMember;
  const total = rows.reduce((s, m) => s + pointsOf(m.id), 0);
  const cols = 6 + (showActs ? ACTIVITIES.length + 1 : 0) + (isMember ? 2 : 0);

  return (
    <section className="panel sheet-panel">
      <div className="panel-title-row">
        <h2 className="panel-title">
          📋 문파원 현황 <span className="muted small">{rows.length}명</span>
        </h2>
        {showActs && (
          <div className="week-nav">
            <button className="btn btn-small" onClick={() => changeWeek(addDays(week, -7))} aria-label="이전 주">
              ◀
            </button>
            <span className="week-label">
              {weekLabel(week)}
              {week === current && <span className="badge">이번 주</span>}
            </span>
            <button className="btn btn-small" disabled={week >= current} onClick={() => changeWeek(addDays(week, 7))} aria-label="다음 주">
              ▶
            </button>
          </div>
        )}
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
      {editable && <QuickAdd existing={roster.data ?? []} initial={rows.length ? '' : query.trim()} onAdded={() => { roster.reload(); onChanged?.(); }} />}
      {editable && <p className="muted small">칸을 누르면 바로 저장됩니다. 콘텐츠는 누르면 1점, 분신·디코는 횟수를 적으세요 (분신은 분신으로만 참여한 콘텐츠 수). 결산한 주는 고쳐도 이미 나눈 엽전은 바뀌지 않습니다.</p>}

      {roster.error && <p className="error">{roster.error}</p>}
      <div className="table-wrap">
        <table className="table sheet">
          <thead>
            <tr>
              <th>#</th>
              <th>직위</th>
              <th>닉네임</th>
              <th className="r">전 전투력</th>
              <th className="r">현 전투력</th>
              <th className="r">성장</th>
              {showActs &&
                ACTIVITIES.map((a) => (
                  <th key={a.key} className="center" title={`${a.label} (${pts?.[a.key] ?? 0}점${a.multi ? ' × 횟수' : ''})`}>
                    {a.short}
                  </th>
                ))}
              {showActs && <th className="r">점수</th>}
              {isMember && <th className="r">누적엽전</th>}
              {isMember && <th className="r">보유엽전</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={m.id} className={[m.id === myRoster?.id ? 'me-row' : '', m.active ? '' : 'dim'].join(' ').trim() || undefined}>
                <td className="muted num">{i + 1}</td>
                <td>
                  <span className={`rank-badge rank-badge-${rankOrder(m)}`}>{m.rank}</span>
                </td>
                <td className="strong">
                  {m.nickname}
                  {!m.active && <span className="muted small"> (쉬는 중)</span>}
                </td>
                <td className="r num muted">{m.prev_power === null ? '-' : fmt(m.prev_power)}</td>
                <td className="r num">{fmt(m.combat_power)}</td>
                <td className={`r num ${m.growth > 0 ? 'up' : m.growth < 0 ? 'down' : 'muted'}`}>
                  {m.growth > 0 ? `▲ ${fmt(m.growth)}` : m.growth < 0 ? `▼ ${fmt(-m.growth)}` : '-'}
                </td>
                {showActs &&
                  ACTIVITIES.map((a) => {
                    const n = merged[m.id]?.[a.key] ?? 0;
                    return (
                      <td key={a.key} className="center">
                        {editable ? (
                          a.multi ? (
                            <input
                              className="input input-tiny num"
                              inputMode="numeric"
                              aria-label={`${m.nickname} ${a.label} 횟수`}
                              value={n || ''}
                              placeholder="0"
                              onChange={(e) => setCount(m, a.key, Math.min(50, Number(e.target.value.replace(/\D/g, '')) || 0))}
                            />
                          ) : (
                            <button
                              type="button"
                              className={`pt-toggle${n > 0 ? ' on' : ''}`}
                              aria-label={`${m.nickname} ${a.label}`}
                              aria-pressed={n > 0}
                              onClick={() => setCount(m, a.key, n > 0 ? 0 : 1)}
                            >
                              {n > 0 ? (pts?.[a.key] ?? 1) : '·'}
                            </button>
                          )
                        ) : n > 0 ? (
                          <span className="check-on">{a.multi ? n : (pts?.[a.key] ?? 1)}</span>
                        ) : (
                          <span className="check-off">·</span>
                        )}
                      </td>
                    );
                  })}
                {showActs && <td className="r num strong">{pointsOf(m.id) || <span className="muted">0</span>}</td>}
                {isMember && <td className="r num">{fmt(m.earned)}</td>}
                {isMember && <td className="r num strong">{fmt(m.coins)}</td>}
              </tr>
            ))}
            {roster.data && rows.length === 0 && (
              <tr>
                <td colSpan={cols} className="muted center">
                  {query ? '찾는 문파원이 없습니다.' : '명단이 비어 있습니다. 운영진이 문파 관리 > 명단 관리에서 추가합니다.'}
                </td>
              </tr>
            )}
          </tbody>
          {showActs && rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6} className="muted">
                  참여 인원
                </td>
                {ACTIVITIES.map((a) => (
                  <td key={a.key} className="center num muted">
                    {rows.filter((m) => (merged[m.id]?.[a.key] ?? 0) > 0).length}
                  </td>
                ))}
                <td className="r num strong">{total}</td>
                {isMember && <td colSpan={2} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!roster.data && !roster.error && <p className="muted center pad">불러오는 중…</p>}
      {!isMember && <p className="muted small">콘텐츠 참여와 엽전은 로그인한 문파원에게만 보입니다.</p>}
    </section>
  );
}

/** 운영진용: 가입하지 않은 신규 문파원을 표에서 바로 명단에 추가 (쉼표·줄바꿈으로 여러 명) */
function QuickAdd({ existing, initial, onAdded }: { existing: RosterMember[]; initial: string; onAdded: () => void }) {
  const [names, setNames] = useState('');
  const [rank, setRank] = useState<Rank>('문파원');
  const { busy, run } = useAction();
  const text = names || initial;
  const list = [...new Set(text.split(/[,\n]/).map((n) => n.trim()).filter(Boolean))];
  const dup = list.filter((n) => existing.some((m) => m.nickname === n));
  const fresh = list.filter((n) => !dup.includes(n));

  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          for (const nickname of fresh) await api.saveRoster({ nickname, rank, combat_power: 0, active: true });
        }, `${fresh.join(', ')} 님을 명단에 추가했습니다`).then((ok) => {
          if (ok) {
            setNames('');
            onAdded();
          }
        });
      }}
    >
      <span className="small strong">+ 신규 문파원</span>
      <input
        className="input"
        placeholder="게임 닉네임 (여러 명은 쉼표로)"
        maxLength={200}
        value={text}
        onChange={(e) => setNames(e.target.value)}
        aria-label="추가할 닉네임"
      />
      <select className="input" style={{ width: 'auto' }} value={rank} onChange={(e) => setRank(e.target.value as Rank)} aria-label="직위">
        {RANKS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <button className="btn btn-small btn-red" disabled={busy || !fresh.length}>
        {fresh.length > 1 ? `${fresh.length}명 추가` : '추가'}
      </button>
      {dup.length > 0 && <span className="muted small">이미 명단에 있음: {dup.join(', ')}</span>}
    </form>
  );
}
