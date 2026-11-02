import { useEffect, useState } from 'react';
import { api, fmt, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useLoad } from '../lib/hooks';
import { BONUSES, weekWinners, withShares, type Settlement, type SettlementRow } from '../lib/types';
import { addDays, shortDate, today, weekLabel, weekStart } from '../lib/week';

/** 운영진용: 그 주 문파 엽전을 참여 점수 비율로 분배하고, 최고 전투력·최고 성장에게 보너스 엽전 지급 */
export function WeeklySettlement({ refreshKey }: { refreshKey: number }) {
  const settlements = useLoad(() => api.listSettlements());
  const guild = useLoad(() => api.getGuild());
  const { busy, run } = useAction();
  const [pool, setPool] = useState('');

  // 결산할 수 있는 주: 지난 주·이번 주 중 마지막 결산보다 뒤인 주 (수요일에 지난 주를 결산하는 게 기본)
  const thisWeek = weekStart(today());
  const latest = settlements.data?.[0]?.week;
  const options = [addDays(thisWeek, -7), thisWeek].filter((w) => !latest || w > latest);
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => {
    if (settlements.data) setWeek((w) => (w && options.includes(w) ? w : (options[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlements.data]);

  const preview = useLoad(() => (week ? api.previewWeek(week) : Promise.resolve([])), [week, refreshKey]);
  const bonus = guild.data?.weekly_bonus;
  const poolNum = Math.floor(Number(pool) || 0);
  const rows = withShares(preview.data ?? [], poolNum);
  const totalPoints = rows.reduce((s, r) => s + r.points, 0);
  const handed = rows.reduce((s, r) => s + r.share, 0);
  const reload = () => {
    settlements.reload();
    setPool('');
  };

  // 문파 엽전 차액: 지난 결산 때 기록한 보유량 → 지금 보유량 (지난 결산 뒤에 입력했을 때만)
  const g = guild.data;
  const last = settlements.data?.[0];
  const fresh = !!g?.coins_at && (!last || g.coins_at > last.settled_at);
  const diff = fresh && last?.guild_coins != null ? g!.coins - last.guild_coins : null;
  useEffect(() => {
    if (diff != null && diff >= 0) setPool(String(diff));
  }, [diff]);

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
          매주 수요일, 위에서 전투력을 갱신한 뒤 지난 주를 결산하세요. 그 주에 모인 문파 엽전을 참여 점수 비율로 나누고(1전 미만은 버림, 남는 엽전은 문파에 남음), 지난 결산과 비교한
          전투력으로 보너스를 줍니다. 동점이면 모두 받습니다.
          {bonus && <> {BONUSES.map((b) => `${b.icon} ${b.label} +${fmt(bonus[b.key])}전`).join(' · ')}</>}
        </p>
        <GuildCoins coins={g?.coins ?? 0} coinsAt={g?.coins_at ?? null} onSaved={guild.reload} />
        {fresh && last && last.guild_coins == null && (
          <p className="week-note">지난 결산 때 기록한 문파 엽전이 없어 차액을 계산할 수 없습니다. 이번에는 모인 엽전을 직접 적어 주세요. 다음 결산부터 자동으로 계산합니다.</p>
        )}
        {diff != null && (
          <p className="week-note">
            지난 결산({fmtDate(last!.settled_at)}) 때 {fmt(last!.guild_coins!)}전 → 지금 {fmt(g!.coins)}전,{' '}
            {diff >= 0 ? (
              <>
                차액 <strong>{fmt(diff)}전</strong>을 분배 엽전으로 넣었습니다. 문파 상점에서 쓴 엽전이 있으면 그만큼 더해 고쳐 주세요.
              </>
            ) : (
              <>차액이 {fmt(diff)}전입니다. 그 사이 문파 엽전을 썼다면 모인 엽전을 직접 적어 주세요.</>
            )}
          </p>
        )}
        {!fresh && week && <p className="week-note">결산하기 전에 위에 지금 게임의 문파 엽전을 입력하면, 지난 결산 때와의 차액을 분배 엽전으로 자동으로 넣습니다.</p>}
        {!week && settlements.data && <p className="week-note">이번 주까지 결산을 마쳤습니다. 다음 주 수요일에 다시 결산하세요.</p>}
        {week && preview.data && (
          <>
            <div className="form-row settle-form">
              <label className="field">
                <span>{weekLabel(week)}에 모인 문파 엽전</span>
                <input className="input num" inputMode="numeric" placeholder="예: 5000" value={pool} onChange={(e) => setPool(e.target.value.replace(/\D/g, ''))} />
              </label>
              <div className="settle-sum">
                <span>
                  점수 합계 <strong>{fmt(totalPoints)}점</strong>
                </span>
                <span>
                  분배 <strong>{fmt(handed)}전</strong>
                </span>
                <span className="muted">문파에 남음 {fmt(poolNum - handed)}전</span>
              </div>
            </div>
            <SettlementTable rows={rows} />
            <div className="row-end">
              <button
                className="btn btn-red"
                disabled={busy || !preview.data.length || pool === ''}
                onClick={() => {
                  if (!confirm(`${weekLabel(week)} 결산을 확정할까요?\n문파 엽전 ${fmt(poolNum)}전 중 ${fmt(handed)}전을 나누고 보너스를 바로 지급합니다.`)) return;
                  run(() => api.settleWeek(week, poolNum), `${shortDate(week)} 주 결산을 마쳤습니다`).then((ok) => ok && reload());
                }}
              >
                {shortDate(week)} 주 결산하기
              </button>
            </div>
          </>
        )}
      </section>

      {!!settlements.data?.length && (
        <section className="panel">
          <h2 className="panel-title">지난 결산</h2>
          <SettlementList list={settlements.data} onCancel={(w) => run(() => api.cancelSettlement(w), '결산을 취소했습니다').then((ok) => ok && reload())} busy={busy} />
        </section>
      )}
    </>
  );
}

/** 지금 게임의 문파 엽전 보유량 입력 (결산 때 함께 기록되어 다음 주 차액 계산에 쓰임) */
function GuildCoins({ coins, coinsAt, onSaved }: { coins: number; coinsAt: string | null; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const { busy, run } = useAction();
  return (
    <div className="form-row settle-form">
      <label className="field">
        <span>지금 문파 엽전 (게임 화면 보유량)</span>
        <input className="input num" inputMode="numeric" placeholder={coinsAt ? String(coins) : '예: 17200'} value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button
        className="btn"
        disabled={busy || value === ''}
        onClick={() => run(() => api.updateGuild({ coins: Number(value) }), '문파 엽전을 저장했습니다').then((ok) => ok && (setValue(''), onSaved()))}
      >
        저장
      </button>
      <span className="muted small">{coinsAt ? `현재 ${fmt(coins)}전 · ${fmtDate(coinsAt)} 입력` : '아직 입력하지 않았습니다'}</span>
    </div>
  );
}

/** 결산 목록 (펼치면 표). onCancel 이 있으면 가장 최근 결산에 취소 버튼 */
export function SettlementList({ list, onCancel, busy }: { list: Settlement[]; onCancel?: (week: string) => void; busy?: boolean }) {
  return (
    <ul className="settled-weeks">
      {list.map((w, i) => {
        const win = weekWinners(w.rows);
        const names = (ids: Set<string>) => w.rows.filter((r) => ids.has(r.roster_id)).map((r) => r.nickname).join(', ') || '-';
        return (
          <li key={w.week}>
            <details>
              <summary>
                <strong>{weekLabel(w.week)}</strong>
                <span className="muted small">
                  {' '}
                  {fmtDate(w.settled_at)} 결산 · 분배 엽전 {fmt(w.pool)}전 · {w.total_points}점
                  {w.guild_coins != null && ` · 결산 때 문파 엽전 ${fmt(w.guild_coins)}전`}
                </span>
                <span className="award-line">
                  👑 {names(win.powerIds)} · 🔥 {names(win.growthIds)}
                  {win.topGrowth > 0 ? ` (+${fmt(win.topGrowth)})` : ''}
                </span>
              </summary>
              <SettlementTable rows={w.rows} />
              {onCancel && i === 0 && (
                <button
                  className="link-btn danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('이 결산을 취소할까요? 나눠 준 엽전과 보너스도 회수됩니다.')) onCancel(w.week);
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
  );
}

function SettlementTable({ rows }: { rows: SettlementRow[] }) {
  const win = weekWinners(rows);
  if (!rows.length) return <p className="muted">명단에 문파원이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>닉네임</th>
            <th className="r">점수</th>
            <th className="r">분배</th>
            <th className="r">지난 결산</th>
            <th className="r">전투력</th>
            <th className="r">변화</th>
            <th>보너스</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.prev_power === null ? null : r.power - r.prev_power;
            return (
              <tr key={r.roster_id}>
                <td className="strong">{r.nickname}</td>
                <td className="r num">{r.points || <span className="muted">0</span>}</td>
                <td className="r num strong">{r.share ? `${fmt(r.share)}전` : <span className="muted">-</span>}</td>
                <td className="r num muted">{r.prev_power === null ? '기록 없음' : fmt(r.prev_power)}</td>
                <td className="r num">{fmt(r.power)}</td>
                <td className={`r num ${diff && diff > 0 ? 'up' : diff && diff < 0 ? 'down' : 'muted'}`}>
                  {diff === null ? '-' : diff > 0 ? `▲ ${fmt(diff)}` : diff < 0 ? `▼ ${fmt(-diff)}` : '-'}
                </td>
                <td>
                  {win.powerIds.has(r.roster_id) && <span className="kind kind-top_power">👑 최고 전투력</span>}{' '}
                  {win.growthIds.has(r.roster_id) && <span className="kind kind-top_growth">🔥 최고 성장</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 문파원·첫 화면용: 가장 최근 결산 수상자와 분배 요약 */
export function WeeklyAwards() {
  const { isMember } = useAuth();
  const settlements = useLoad(() => api.listSettlements());
  const guild = useLoad(() => api.getGuild());
  const last = settlements.data?.[0];
  if (!last || !guild.data) return null;
  const win = weekWinners(last.rows);
  const pick = (ids: Set<string>) => last.rows.filter((r) => ids.has(r.roster_id));
  const topShare = [...last.rows].sort((a, b) => b.share - a.share)[0];
  const cards = [
    { ...BONUSES[0], people: pick(win.powerIds), value: fmt(win.topPower) },
    { ...BONUSES[1], people: pick(win.growthIds), value: win.topGrowth > 0 ? `▲ ${fmt(win.topGrowth)}` : '' },
  ];
  return (
    <section className="panel">
      <h2 className="panel-title">
        🏆 주간 결산 <span className="muted small">{weekLabel(last.week)}</span>
      </h2>
      <div className="awards">
        {cards.map((c) => (
          <div key={c.key} className="award">
            <span className="award-icon">{c.icon}</span>
            <div>
              <span className="muted small">
                {c.label} · +{fmt(guild.data!.weekly_bonus[c.key])}전
              </span>
              <strong>{c.people.length ? c.people.map((p) => p.nickname).join(', ') : '해당 없음'}</strong>
              {c.people.length > 0 && <span className={c.key === 'top_growth' ? 'up num' : 'num'}>{c.value}</span>}
            </div>
          </div>
        ))}
        <div className="award">
          <span className="award-icon">🪙</span>
          <div>
            <span className="muted small">
              문파 엽전 {fmt(last.pool)}전 · {last.rows.filter((r) => r.share > 0).length}명 분배
            </span>
            {topShare?.share > 0 ? (
              <>
                <strong>
                  {isMember ? `최다 ${topShare.nickname}` : '참여 점수 비율로 분배'}
                </strong>
                {isMember && <span className="num">{fmt(topShare.share)}전</span>}
              </>
            ) : (
              <strong>분배 없음</strong>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
