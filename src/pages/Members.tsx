import { RosterSheet } from '../components/RosterSheet';
import { ScoreGuide } from '../components/ScoreGuide';
import { SettlementList, WeeklyAwards } from '../components/WeeklySettlement';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';

export function Members() {
  const guild = useLoad(() => api.getGuild());
  const settlements = useLoad(() => api.listSettlements());

  return (
    <div className="page">
      <div className="page-head">
        <h1>문파원</h1>
        <p className="muted">
          전투력은 운영진이 매주 수요일 게임 문파원 목록 캡처로 갱신합니다. 성장은 지난 주간 결산 이후 오른 양이고, 그 주 문파 엽전은 참여 점수 비율대로 나눕니다.
        </p>
      </div>

      <WeeklyAwards />
      <RosterSheet />

      {!!settlements.data?.length && (
        <section className="panel">
          <h2 className="panel-title">지난 주간 결산</h2>
          <SettlementList list={settlements.data} />
        </section>
      )}
      {guild.data && <ScoreGuide guild={guild.data} />}
    </div>
  );
}
