import { useEffect, useState } from 'react';
import { api, fmt, fmtDate } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { BONUSES, weekWinners, type PowerWeekRow } from '../lib/types';
import { addDays, shortDate, today, weekLabel, weekStart } from '../lib/week';

/** 운영진용: 스크린샷으로 갱신한 전투력을 그 주 값으로 확정하고, 최고 전투력·최고 성장에게 보너스 지급 */
export function WeeklySettlement({ refreshKey }: { refreshKey: number }) {
  const weeks = useLoad(() => api.listPowerWeeks());
  const guild = useLoad(() => api.getGuild());
  const { busy, run } = useAction();

  // 결산할 수 있는 주: 지난 주·이번 주 중 마지막 결산보다 뒤인 주 (매주 화요일에 하든 수요일에 지난 주를 하든 맞게)
  const thisWeek = weekStart(today());
  const latest = weeks.data?.[0]?.week;
  const options = [addDays(thisWeek, -7), thisWeek].filter((w) => !latest || w > latest);
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => {
    if (weeks.data) setWeek((w) => (w && options.includes(w) ? w : (options[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks.data]);

  const preview = useLoad(() => (week ? api.previewPowerWeek(week) : Promise.resolve([])), [week, refreshKey]);
  const bonus = guild.data?.weekly_bonus;

  return (
    <>
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">🏆 주간 결산</h2>
          {options.length > 1 && week && (
            <div className="tabs">
              {options.map((w) => (
                <button key={w} className={w === week ? 'tab active' : 'tab'} onClick={() => setWeek(w)}>
                  {w === thisWeek ? '이번 주' : '지난 주'} ({shortDate(w)}~)
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="muted small">
          위에서 스크린샷으로 전투력을 저장한 뒤 결산하세요. 지금 전투력이 그 주 값으로 확정되고, 지난 결산과 비교해 보너스를 줍니다. 동점이면 모두 받습니다.
          {bonus && (
            <>
              {' '}
              {BONUSES.map((b) => `${b.icon} ${b.label} +${bonus[b.key]}점`).join(' · ')}
            </>
          )}
        </p>
        {!week && weeks.data && <p className="week-note">이번 주까지 결산을 마쳤습니다. 다음 주에 다시 결산하세요.</p>}
        {week && preview.data && (
          <>
            <p className="week-note">
              {weekLabel(week)} 결산 미리보기
            </p>
            <SettlementTable rows={preview.data} />
            <div className="row-end">
              <button
                className="btn btn-red"
                disabled={busy || !preview.data.length}
                onClick={() => {
                  if (!confirm(`${weekLabel(week)} 결산을 확정할까요? 보너스 점수가 바로 지급됩니다.`)) return;
                  run(() => api.settlePowerWeek(week), `${shortDate(week)} 주 결산을 마쳤습니다`).then((ok) => ok && weeks.reload());
                }}
              >
                {shortDate(week)} 주 결산하기
              </button>
            </div>
          </>
        )}
      </section>

      {!!weeks.data?.length && (
        <section className="panel">
          <h2 className="panel-title">지난 결산</h2>
          <ul className="settled-weeks">
            {weeks.data.map((w, i) => {
              const win = weekWinners(w.rows);
              const names = (ids: Set<string>) => w.rows.filter((r) => ids.has(r.member_id)).map((r) => r.nickname).join(', ') || '-';
              return (
                <li key={w.week}>
                  <details>
                    <summary>
                      <strong>{weekLabel(w.week)}</strong>
                      <span className="muted small"> {fmtDate(w.settled_at)} 결산 · {w.rows.length}명</span>
                      <span className="award-line">
                        👑 {names(win.powerIds)} ({fmt(win.topPower)}) · 🔥 {names(win.growthIds)}
                        {win.topGrowth > 0 ? ` (+${fmt(win.topGrowth)})` : ''}
                      </span>
                    </summary>
                    <SettlementTable rows={w.rows} />
                    {i === 0 && (
                      <button
                        className="link-btn danger"
                        disabled={busy}
                        onClick={() => {
                          if (!confirm('이 결산을 취소할까요? 지급한 보너스 점수도 회수됩니다.')) return;
                          run(() => api.cancelPowerWeek(w.week), '결산을 취소했습니다').then((ok) => ok && weeks.reload());
                        }}
                      >
                        이 결산 취소
                      </button>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function SettlementTable({ rows }: { rows: PowerWeekRow[] }) {
  const win = weekWinners(rows);
  if (!rows.length) return <p className="muted">전투력이 입력된 문파원이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>닉네임</th>
            <th className="r">지난 결산</th>
            <th className="r">이번 전투력</th>
            <th className="r">변화</th>
            <th>보너스</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.prev_power === null ? null : r.power - r.prev_power;
            return (
              <tr key={r.member_id}>
                <td className="strong">{r.nickname}</td>
                <td className="r num muted">{r.prev_power === null ? '기록 없음' : fmt(r.prev_power)}</td>
                <td className="r num">{fmt(r.power)}</td>
                <td className={`r num ${diff && diff > 0 ? 'up' : diff && diff < 0 ? 'down' : 'muted'}`}>
                  {diff === null ? '-' : diff > 0 ? `▲ ${fmt(diff)}` : diff < 0 ? `▼ ${fmt(-diff)}` : '-'}
                </td>
                <td>
                  {win.powerIds.has(r.member_id) && <span className="kind kind-top_power">👑 최고 전투력</span>}{' '}
                  {win.growthIds.has(r.member_id) && <span className="kind kind-top_growth">🔥 최고 성장</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 문파원·첫 화면용: 가장 최근 결산 수상자 */
export function WeeklyAwards() {
  const weeks = useLoad(() => api.listPowerWeeks());
  const guild = useLoad(() => api.getGuild());
  const last = weeks.data?.[0];
  if (!last || !guild.data) return null;
  const win = weekWinners(last.rows);
  const pick = (ids: Set<string>) => last.rows.filter((r) => ids.has(r.member_id));
  const cards = [
    { ...BONUSES[0], people: pick(win.powerIds), value: fmt(win.topPower) },
    { ...BONUSES[1], people: pick(win.growthIds), value: win.topGrowth > 0 ? `▲ ${fmt(win.topGrowth)}` : '' },
  ];
  return (
    <section className="panel">
      <h2 className="panel-title">
        🏆 주간 결산 수상 <span className="muted small">{weekLabel(last.week)}</span>
      </h2>
      <div className="awards">
        {cards.map((c) => (
          <div key={c.key} className="award">
            <span className="award-icon">{c.icon}</span>
            <div>
              <span className="muted small">
                {c.label} · +{guild.data!.weekly_bonus[c.key]}점
              </span>
              <strong>{c.people.length ? c.people.map((p) => p.nickname).join(', ') : '해당 없음'}</strong>
              {c.people.length > 0 && <span className={c.key === 'top_growth' ? 'up num' : 'num'}>{c.value}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
