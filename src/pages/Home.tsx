import { Link } from 'react-router-dom';
import { Hero } from '../components/Hero';
import { ScoreGuide } from '../components/ScoreGuide';
import { WeeklyAwards } from '../components/WeeklySettlement';
import { api, fmt, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';

export function Home() {
  const { session } = useAuth();
  const guild = useLoad(() => api.getGuild());
  const members = useLoad(() => api.listRoster(), [session?.userId]);

  const g = guild.data;
  const list = (members.data ?? []).filter((m) => m.active);
  const total = list.reduce((s, m) => s + m.combat_power, 0);
  const growth = list.reduce((s, m) => s + Math.max(0, m.growth), 0);
  const top = list.slice(0, 5);
  const risers = list.filter((m) => m.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, 3);

  return (
    <>
      <Hero>
        <p className="eyebrow">도깨비의세계 문파</p>
        <h1 className="title">{g?.name ?? ' '}</h1>
        {g?.motto && <p className="motto">“{g.motto}”</p>}
        <div className="level-box">
          <span className="level">문파 Lv.{g?.level ?? '-'}</span>
          <span className="level-meta">
            문파원 {list.length}명 · 총 전투력 {fmt(total)}
          </span>
        </div>
        <div className="hero-actions">
          <Link to="/members" className="btn btn-gold">
            문파원 보기
          </Link>
          {session ? (
            <Link to="/warehouse" className="btn">
              문파창고
            </Link>
          ) : (
            <Link to="/login" className="btn">
              {g?.recruiting ? '가입 신청' : '로그인'}
            </Link>
          )}
        </div>
      </Hero>

      <div className="page">
        <div className="stats">
          <Stat label="문파 레벨" value={g ? `Lv.${g.level}` : '-'} />
          <Stat label="문파원" value={`${list.length}명`} />
          <Stat label="총 전투력" value={fmt(total)} />
          <Stat label="주간 성장 합계" value={`+${fmt(growth)}`} accent />
          <Stat label={g?.coins_at ? `문파 엽전 (${fmtDate(g.coins_at)})` : '문파 엽전'} value={g?.coins_at ? `${fmt(g.coins)}전` : '-'} />
        </div>

        <div className="grid-2">
          <section className="panel">
            <h2 className="panel-title">📜 문파 공지</h2>
            {g?.notice ? <p className="notice">{g.notice}</p> : <p className="muted">등록된 공지가 없습니다.</p>}
            {g?.recruiting && <p className="recruit">🏮 지금 문파원을 모집하고 있습니다</p>}
          </section>

          <section className="panel">
            <h2 className="panel-title">⚔️ 전투력 순위</h2>
            <ol className="rank-list">
              {top.map((m, i) => (
                <li key={m.id}>
                  <span className={`rank rank-${i + 1}`}>{i + 1}</span>
                  <span className="rank-name">
                    {m.nickname} {m.rank !== '문파원' && <span className="muted small">{m.rank}</span>}
                  </span>
                  <span className="num">{fmt(m.combat_power)}</span>
                </li>
              ))}
              {members.data && top.length === 0 && <li className="muted">아직 문파원이 없습니다.</li>}
            </ol>
            <Link to="/members" className="more">
              전체 문파원 →
            </Link>
          </section>
        </div>

        <section className="panel">
          <h2 className="panel-title">🔥 이번 주 성장 <span className="muted small">지난 결산 이후</span></h2>
          {members.data && risers.length === 0 && <p className="muted">아직 이번 주 전투력 갱신 전입니다.</p>}
          <div className="risers">
            {risers.map((m, i) => (
              <div key={m.id} className="riser">
                <span className="riser-medal">{['🥇', '🥈', '🥉'][i]}</span>
                <strong>{m.nickname}</strong>
                <span className="up">▲ {fmt(m.growth)}</span>
              </div>
            ))}
          </div>
        </section>

        <WeeklyAwards />

        {g && <ScoreGuide guild={g} />}

        <section className="features">
          <Feature icon="👹" title="문파원 현황" text="직위, 전투력과 주간 성장, 콘텐츠 참여와 누적 엽전을 한눈에 봅니다. 전투력은 매주 수요일 갱신합니다." to="/members" />
          <Feature icon="🪙" title="문파 엽전" text="한 주에 모인 문파 엽전을 참여 점수 비율로 나누고, 최고 전투력·최고 성장에게 보너스를 줍니다." to="/me" />
          <Feature icon="📜" title="도술덱" text="문파원이 쓰는 도술 조합을 올리고 추천합니다. 운영진이 고른 문파 추천 덱도 있어요." to="/decks" />
          <Feature icon="📦" title="문파창고" text="모은 엽전으로 창고 아이템을 신청하고, 운영진이 지급합니다." to="/warehouse" />
          <Feature icon="✍️" title="방명록" text="문파원도, 지나가는 손님도 한마디 남길 수 있습니다." to="/guestbook" />
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat panel">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${accent ? ' up' : ''}`}>{value}</span>
    </div>
  );
}

function Feature({ icon, title, text, to }: { icon: string; title: string; text: string; to: string }) {
  return (
    <Link to={to} className="feature panel">
      <span className="feature-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </Link>
  );
}
