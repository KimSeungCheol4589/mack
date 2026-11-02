import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { RoleBadge } from '../components/Layout';
import { api, fmt, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useLoad } from '../lib/hooks';
import { ACTIVITIES, KIND_LABEL, activityPoints, type CoinKind, type WeekActivities } from '../lib/types';
import { today, weekLabel, weekStart } from '../lib/week';

const SUMMARY: { kinds: CoinKind[]; label: string; icon: string }[] = [
  { kinds: ['share'], label: '주간 분배', icon: '🪙' },
  { kinds: ['top_power', 'top_growth'], label: '주간 보너스', icon: '🏆' },
  { kinds: ['adjust'], label: '조정·이전 누적', icon: '✏️' },
  { kinds: ['warehouse'], label: '창고 사용', icon: '📦' },
];

export function MyPage() {
  const { ready, session, me, myRoster, isMember, refreshMe } = useAuth();
  const week = weekStart(today());
  const coins = useLoad(() => (myRoster ? api.listCoins(myRoster.id) : Promise.resolve([])), [myRoster?.id]);
  const acts = useLoad(() => (myRoster ? api.listActivities(week) : Promise.resolve({} as WeekActivities)), [myRoster?.id]);
  const guild = useLoad(() => api.getGuild());
  const [nickname, setNickname] = useState('');
  const { busy, run } = useAction();

  useEffect(() => {
    if (me) setNickname(me.nickname);
  }, [me]);

  if (ready && !session) return <Navigate to="/login" replace />;
  if (!me) return <div className="page"><p className="muted">불러오는 중…</p></div>;
  const mine = myRoster ? acts.data?.[myRoster.id] : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <h1>내 정보</h1>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">
            {me.nickname} <RoleBadge role={me.role} approved={me.approved} />
            {myRoster && <span className="muted small"> · {myRoster.rank}</span>}
          </h2>
          {myRoster ? (
            <>
              <div className="mini-stats">
                <div>
                  <span className="stat-label">전투력</span>
                  <span className="stat-value">{fmt(myRoster.combat_power)}</span>
                </div>
                <div>
                  <span className="stat-label">주간 성장</span>
                  <span className="stat-value up">{myRoster.growth > 0 ? `▲ ${fmt(myRoster.growth)}` : '-'}</span>
                </div>
                <div>
                  <span className="stat-label">보유 엽전</span>
                  <span className="stat-value">{fmt(myRoster.coins)}</span>
                </div>
                <div>
                  <span className="stat-label">누적 엽전</span>
                  <span className="stat-value muted">{fmt(myRoster.earned)}</span>
                </div>
              </div>
              <p className="muted small">전투력은 운영진이 매주 수요일 게임 문파원 목록 캡처로 갱신합니다. 값이 다르면 운영진에게 알려 주세요.</p>
            </>
          ) : (
            me.approved && (
              <p className="recruit">
                문파원 명단과 아직 연결되지 않았습니다. 오른쪽에서 닉네임을 게임 닉네임과 똑같이 바꾸면 자동으로 연결되고, 그래도 안 되면 운영진에게 연결을 요청하세요.
              </p>
            )
          )}
          {!me.approved && <p className="recruit">가입 승인 대기 중입니다. 운영진이 승인하면 엽전과 창고를 이용할 수 있습니다.</p>}
        </section>

        <section className="panel">
          <h2 className="panel-title">닉네임 변경</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => api.updateMyProfile({ nickname: nickname.trim() }), '저장했습니다');
              if (ok) refreshMe();
            }}
          >
            <label className="field">
              <span>닉네임 (게임 닉네임과 똑같이)</span>
              <input className="input" required maxLength={20} value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
            <button className="btn btn-red" disabled={busy}>
              저장
            </button>
          </form>
        </section>
      </div>

      {isMember && myRoster && (
        <section className="panel">
          <h2 className="panel-title">
            이번 주 참여 <span className="muted small">{weekLabel(week)}</span>
          </h2>
          <div className="activity-counts">
            {ACTIVITIES.map((a) => (
              <div key={a.key} className="activity-count">
                <span className="muted small">
                  {a.icon} {a.label}
                </span>
                <strong>{mine?.[a.key] ? (a.multi ? `${mine[a.key]}회` : '✓') : '-'}</strong>
              </div>
            ))}
            <div className="activity-count">
              <span className="muted small">이번 주 점수</span>
              <strong>{guild.data ? activityPoints(mine, guild.data.activity_points) : '-'}점</strong>
            </div>
          </div>
        </section>
      )}

      {isMember && myRoster && (
        <section className="panel">
          <h2 className="panel-title">엽전 내역</h2>
          <div className="activity-counts">
            {SUMMARY.map((s) => {
              const sum = (coins.data ?? []).filter((c) => s.kinds.includes(c.kind)).reduce((t, c) => t + c.delta, 0);
              return (
                <div key={s.label} className="activity-count">
                  <span className="muted small">
                    {s.icon} {s.label}
                  </span>
                  <strong className={sum > 0 ? 'up' : sum < 0 ? 'down' : undefined}>
                    {sum > 0 ? '+' : ''}
                    {fmt(sum)}전
                  </strong>
                </div>
              );
            })}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>구분</th>
                  <th>내용</th>
                  <th className="r">엽전</th>
                </tr>
              </thead>
              <tbody>
                {(coins.data ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{fmtDate(l.created_at)}</td>
                    <td>
                      <span className={`kind kind-${l.kind}`}>{KIND_LABEL[l.kind]}</span>
                    </td>
                    <td>{l.reason}</td>
                    <td className={`r num ${l.delta > 0 ? 'up' : 'down'}`}>
                      {l.delta > 0 ? '+' : ''}
                      {fmt(l.delta)}
                    </td>
                  </tr>
                ))}
                {coins.data?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted center">
                      아직 엽전 기록이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
