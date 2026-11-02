import { fmt } from '../lib/api';
import { ACTIVITIES, BONUSES, type Guild } from '../lib/types';

/** 엽전 분배 기준표: 콘텐츠 참여 점수 비율로 그 주 문파 엽전을 나누고, 주간 보너스를 더함 */
export function ScoreGuide({ guild }: { guild: Guild }) {
  return (
    <section className="panel">
      <h2 className="panel-title">🪙 문파 엽전 분배 기준</h2>
      <p className="formula">
        내 분배 엽전 = 그 주 문파 엽전 × <strong>내 점수</strong> ÷ <strong>모든 문파원 점수 합계</strong> <span className="muted small">(1전 미만 버림)</span>
      </p>
      <div className="guide-grid">
        <div>
          <h3 className="guide-title">참여 점수</h3>
          <p className="muted small">한 주는 수요일에 시작합니다. 콘텐츠는 주 1회, 디코는 참여한 횟수만큼 점수를 받습니다. 운영진이 기록합니다.</p>
          <table className="table guide-table">
            <tbody>
              {ACTIVITIES.map((a) => (
                <tr key={a.key}>
                  <td>
                    {a.icon} {a.label}
                  </td>
                  <td className="r num strong">
                    {fmt(guild.activity_points[a.key] ?? 0)}점 {a.multi ? '/ 1회' : '/ 주'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="guide-title">주간 보너스</h3>
          <p className="muted small">매주 수요일 운영진이 문파원 목록 캡처로 전투력을 갱신하고 결산할 때 지급됩니다. 동점이면 모두 받습니다.</p>
          <table className="table guide-table">
            <tbody>
              {BONUSES.map((b) => (
                <tr key={b.key}>
                  <td>
                    {b.icon} {b.label}
                    <div className="muted small">{b.desc}</div>
                  </td>
                  <td className="r num strong">+{fmt(guild.weekly_bonus?.[b.key] ?? 0)}전</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">모은 엽전은 문파창고 물품을 신청할 때 씁니다.</p>
        </div>
      </div>
    </section>
  );
}
