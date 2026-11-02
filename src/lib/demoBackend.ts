// Supabase 연결 전에 화면을 미리 써 볼 수 있는 체험용 백엔드.
// 데이터는 이 브라우저의 localStorage 에만 저장되며, 권한 규칙은 supabase/schema.sql 과 같게 맞춰 두었습니다.
import {
  DEFAULT_ACTIVITY_POINTS,
  DEFAULT_WEEKLY_BONUS,
  activityPoints,
  weekWinners,
  withShares,
  type ActivityKey,
  type Backend,
  type CoinEntry,
  type CoinKind,
  type Deck,
  type GuestbookEntry,
  type Guild,
  type Item,
  type ItemRequest,
  type Member,
  type Rank,
  type RequestStatus,
  type Role,
  type RosterMember,
  type Session,
  type SettlementRow,
  type WeekActivities,
} from './types';
import { addDays, shortDate, today, weekStart } from './week';

interface Profile {
  id: string;
  nickname: string;
  role: Role;
  approved: boolean;
  joined_at: string;
}

interface RawRoster {
  id: string;
  nickname: string;
  rank: Rank;
  combat_power: number;
  active: boolean;
  profile_id: string | null;
  created_at: string;
}

interface RawRequest {
  id: string;
  roster_id: string;
  item_id: string;
  quantity: number;
  total_cost: number;
  status: RequestStatus;
  note: string;
  created_at: string;
  decided_at: string | null;
}

type RawDeck = Omit<Deck, 'author_nickname' | 'like_count' | 'liked_by_me'>;

type RawRow = Omit<SettlementRow, 'nickname'>;
interface RawSettlement {
  week: string;
  pool: number;
  total_points: number;
  guild_coins: number | null;
  settled_at: string;
  rows: RawRow[];
}

interface DemoState {
  guild: Guild;
  profiles: Profile[];
  roster: RawRoster[];
  history: { roster_id: string; combat_power: number; recorded_at: string }[];
  activities: { roster_id: string; kind: ActivityKey; week: string; count: number }[];
  coins: CoinEntry[];
  settlements: RawSettlement[];
  items: Item[];
  requests: RawRequest[];
  decks: RawDeck[];
  deckLikes: { deck_id: string; member_id: string }[];
  guestbook: GuestbookEntry[];
  visits: { day: string; visitor: string }[];
  session: Session | null;
}

// 데이터 구조가 바뀌면 버전을 올려 예전 체험 데이터를 새로 시작합니다.
const STORAGE_KEY = 'dokkaebi-guild-demo-v10';
const DAY = 86_400_000;

export const DEMO_ACCOUNTS = [
  { email: 'master@demo', label: '문주로 둘러보기', desc: '모든 관리 기능' },
  { email: 'officer@demo', label: '부문주로 둘러보기', desc: '명단·참여 기록·결산·창고 관리' },
  { email: 'member@demo', label: '문파원으로 둘러보기', desc: '내 엽전·창고 신청' },
  { email: 'pending@demo', label: '가입 대기자로 둘러보기', desc: '승인 전 화면' },
];

function ago(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 결산 엽전 원장 줄 (schema.sql 의 settle_week 와 같은 규칙) */
function settlementCoins(week: string, rows: RawRow[], bonus: Guild['weekly_bonus'], created_at: string): CoinEntry[] {
  const label = `${shortDate(week)} 주`;
  const out: CoinEntry[] = [];
  const push = (roster_id: string, delta: number, kind: CoinKind, reason: string) =>
    out.push({ id: uid(), roster_id, delta, kind, week, reason, created_at });
  rows.filter((r) => r.share > 0).forEach((r) => push(r.roster_id, r.share, 'share', `주간 분배 ${label} (${r.points}점)`));
  const w = weekWinners(rows);
  if (bonus.top_power > 0)
    w.powerIds.forEach((id) => push(id, bonus.top_power, 'top_power', `주간 최고 전투력 ${label} (${w.topPower.toLocaleString('ko-KR')})`));
  if (bonus.top_growth > 0)
    w.growthIds.forEach((id) => push(id, bonus.top_growth, 'top_growth', `주간 최고 성장 ${label} (+${w.topGrowth.toLocaleString('ko-KR')})`));
  return out;
}

function seed(): DemoState {
  // 홈페이지 계정 (체험 로그인용)
  const profiles: Profile[] = (
    [
      ['master', '청사초롱', 'master', true],
      ['officer', '달빛방망이', 'officer', true],
      ['m3', '홍련', 'officer', true],
      ['member', '푸른도깨비불', 'member', true],
      ['m5', '감자전', 'member', true],
      ['m6', '은하수', 'member', true],
      ['pending', '떠돌이무사', 'member', false],
    ] as [string, string, Role, boolean][]
  ).map(([id, nickname, role, approved], i) => ({ id, nickname, role, approved, joined_at: ago(approved ? 120 - i * 9 : 1) }));

  // 문파원 명단: 닉네임, 직위, 지금 전투력, 지난 결산(2주 전) 전투력
  const people: [string, Rank, number, number][] = [
    ['청사초롱', '문파장', 286_400, 281_900],
    ['달빛방망이', '부문파장', 271_300, 262_800],
    ['홍련', '부문파장', 266_050, 264_900],
    ['푸른도깨비불', '문파원', 249_800, 241_200],
    ['감자전', '문파원', 238_100, 236_400],
    ['은하수', '문파원', 231_480, 223_900],
    ['먹구름', '문파원', 224_020, 223_870],
    ['호랑이담배', '문파원', 219_760, 212_010],
    ['솔바람', '문파원', 208_400, 207_800],
    ['도토리묵', '문파원', 199_150, 191_300],
    ['새벽별', '문파원', 187_980, 187_100],
    ['깨비깨비', '문파원', 176_300, 168_750],
    ['메밀묵', '문파원', 165_900, 165_900],
    ['불여우', '문파원', 158_200, 154_000],
  ];
  const roster: RawRoster[] = people.map(([nickname, rank, power], i) => ({
    id: `r${i + 1}`,
    nickname,
    rank,
    combat_power: power,
    active: true,
    profile_id: profiles.find((p) => p.approved && p.nickname === nickname)?.id ?? null,
    created_at: ago(120 - i),
  }));
  const history = people.flatMap(([, , power, before], i) => [
    { roster_id: `r${i + 1}`, combat_power: before - 2_000 - ((i * 677) % 3_900), recorded_at: ago(30) },
    { roster_id: `r${i + 1}`, combat_power: before, recorded_at: ago(15) },
    { roster_id: `r${i + 1}`, combat_power: power, recorded_at: ago(1) },
  ]);

  // 2주 전 · 지난 주 · 이번 주 콘텐츠 참여 (가끔 빠짐, 디코는 0~3회)
  const thisWeek = weekStart(today());
  const activities: DemoState['activities'] = [];
  [-14, -7, 0].forEach((offset, w) => {
    const week = addDays(thisWeek, offset);
    roster.forEach((r, i) => {
      (['yosin', 'barrier', 'singi', 'garden'] as ActivityKey[]).forEach((kind, k) => {
        if (offset === 0 && k > 1) return; // 이번 주는 아직 진행 중
        if ((i + k + w) % 4 !== 3) activities.push({ roster_id: r.id, kind, week, count: 1 });
      });
      const d = (i * 7 + w * 3) % 4;
      if (d > 0 && offset !== 0) activities.push({ roster_id: r.id, kind: 'discord', week, count: d });
    });
  });

  // 엑셀에서 옮겨 온 누적엽전
  const coins: CoinEntry[] = roster
    .map((r, i) => ({ r, amount: i < 3 ? 1000 : i % 3 === 0 ? 500 : 0 }))
    .filter((x) => x.amount > 0)
    .map(({ r, amount }) => ({ id: uid(), roster_id: r.id, delta: amount, kind: 'adjust' as const, week: null, reason: '엑셀 누적엽전', created_at: ago(20) }));

  // 2주 전 주간 결산 (지난 주는 아직 결산 전이라 관리 화면에서 해 볼 수 있음)
  const settledWeek = addDays(thisWeek, -14);
  const points = (id: string, week: string) =>
    activityPoints(
      Object.fromEntries(activities.filter((a) => a.roster_id === id && a.week === week).map((a) => [a.kind, a.count])),
      DEFAULT_ACTIVITY_POINTS,
    );
  const pool = 4_200;
  const rows: RawRow[] = withShares(
    people.map(([, , , before], i) => ({
      roster_id: `r${i + 1}`,
      prev_power: before - 2_000 - ((i * 677) % 3_900),
      power: before,
      points: points(`r${i + 1}`, settledWeek),
    })),
    pool,
  );
  const settled_at = ago(14 - 6);
  const settlements: RawSettlement[] = [
    { week: settledWeek, pool, total_points: rows.reduce((s, r) => s + r.points, 0), guild_coins: 12_000, settled_at, rows },
  ];
  coins.push(...settlementCoins(settledWeek, rows, DEFAULT_WEEKLY_BONUS, settled_at));

  // 문파 상점에서 사서 문파 창고에 넣어 둔 물품 (가격은 엽전)
  const items: Item[] = [
    ['용맹의 강타 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '강타 도술 조각 중 하나를 골라 받는 상자', 4, 300],
    ['용맹의 연타 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '연타 도술 조각 중 하나를 골라 받는 상자', 3, 300],
    ['용맹의 저격 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '저격 도술 조각 중 하나를 골라 받는 상자', 3, 300],
    ['용맹의 결명 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '결명 도술 조각 중 하나를 골라 받는 상자', 2, 300],
    ['용맹의 강인 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '강인 도술 조각 중 하나를 골라 받는 상자', 2, 300],
    ['용맹의 파멸 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '파멸 도술 조각 중 하나를 골라 받는 상자', 2, 300],
    ['용맹의 현신 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '현신 도술 조각 중 하나를 골라 받는 상자', 1, 300],
    ['용맹의 특별 도술 조각 랜덤 상자', '도술 조각', 'img:special-random', '특별 도술 조각 하나가 무작위로 나오는 상자', 2, 500],
    ['용맹의 특별 도술 조각 선택 상자', '도술 조각', 'img:special-select', '특별 도술 조각 중 하나를 골라 받는 상자', 1, 1500],
    ['영웅 무기 도안 선택 상자', '도안', '📜', '영웅 등급 무기 도안 선택 (문파 Lv.7 상품)', 3, 600],
    ['산척의 방어구 도안 선택 상자', '도안', '📜', '영웅 등급 방어구 도안 선택 (문파 Lv.7 상품)', 3, 600],
    ['영웅 장신구 도안 선택 상자', '도안', '📜', '영웅 등급 장신구 도안 선택 (문파 Lv.7 상품)', 2, 600],
    ['전설 무기 도안 선택 상자', '도안', '🗡️', '전설 등급 무기 도안 선택 (문파 Lv.20 상품)', 0, 2000],
    ['희귀 가호의 정수', '가호', 'img:rare-essence', '가호 강화 재료 (희귀)', 60, 10],
    ['영웅 가호의 정수', '가호', 'img:hero-essence', '가호 강화 재료 (영웅)', 25, 40],
    ['전설 가호의 정수', '가호', 'img:legend-essence', '가호 강화 재료 (전설)', 8, 120],
    ['가호 주머니', '가호', 'img:pouch', '가호를 얻을 수 있는 주머니', 12, 80],
    ['요혼석', '소모품', 'img:yohonseok', '문파 상점 요혼석', 150, 10],
    ['특급 체력 회복 물약', '소모품', 'img:potion', '사냥·전장용 특급 체력 회복 물약', 40, 15],
  ].map(([name, category, icon, description, stock, cost]) => ({
    id: uid(),
    name: name as string,
    category: category as string,
    icon: icon as string,
    description: description as string,
    stock: stock as number,
    cost: cost as number,
    active: true,
  }));

  const requests: RawRequest[] = [
    { id: uid(), roster_id: 'r4', item_id: items[0].id, quantity: 1, total_cost: 300, status: 'approved', note: '강타 세팅용', created_at: ago(5), decided_at: ago(4) },
    { id: uid(), roster_id: 'r4', item_id: items[16].id, quantity: 2, total_cost: 160, status: 'pending', note: '', created_at: ago(0.3), decided_at: null },
    { id: uid(), roster_id: 'r6', item_id: items[9].id, quantity: 1, total_cost: 600, status: 'pending', note: '무기 교체', created_at: ago(0.1), decided_at: null },
  ];
  coins.push({ id: uid(), roster_id: 'r4', delta: -300, kind: 'warehouse', week: null, reason: `${items[0].name} x1`, created_at: ago(4) });

  const { decks, deckLikes, guestbook } = seedDecks();

  return {
    guild: {
      name: '우리 문파',
      level: 7,
      motto: '함께 사냥하고, 함께 강해진다',
      notice:
        '전투력은 매주 수요일 운영진이 문파원 목록 캡처로 갱신합니다.\n그 주 문파 엽전은 콘텐츠 참여 점수 비율대로 나누고, 최고 전투력·최고 성장에게는 300전씩 드립니다.',
      recruiting: true,
      activity_points: DEFAULT_ACTIVITY_POINTS,
      weekly_bonus: DEFAULT_WEEKLY_BONUS,
      coins: 17_200,
      coins_at: ago(1),
    },
    profiles,
    roster,
    history,
    activities,
    coins,
    settlements,
    items,
    requests,
    decks,
    deckLikes,
    guestbook,
    visits: [],
    session: null,
  };
}

function seedDecks() {
  const deck = (
    id: string, author_id: string, title: string, purpose: string, slots: string[], ultimate_style: string,
    description: string, guild_pick: boolean, days: number,
  ): RawDeck => ({
    id, author_id, title, purpose, slots, ultimate_style, description, video_url: '', guild_pick,
    created_at: ago(days), updated_at: ago(days),
  });
  const decks: RawDeck[] = [
    deck('d1', 'master', '강타 보스 단일딜', '보스',
      ['대검 강타', '검기 폭발', '검기 날리기', '연속 충격', '크게 베기', '일점 저격', '꿰뚫는 저격', '용맹의 기운'], '강타',
      '강타 5개로 궁극기를 열고 저격 두 개로 마무리. 요신 토벌령 보스에 문파 기준 덱입니다.\n용맹의 기운은 보스 페이즈 전환 직전에 쓰세요.', true, 6),
    deck('d2', 'officer', '파멸 광역 사냥', '사냥',
      ['하늘의 심판', '번개 폭풍', '화염구', '연쇄 번개', '얼음화살', '붕괴하는 대지', '생명의 흐름', '도깨비 불'], '파멸',
      '파멸 궁극기 + 연쇄 번개로 몰이 사냥. 황무지 이후 사냥터에서 무난합니다.', true, 4),
    deck('d3', 'member', '저격 결계지 방어용', '범용',
      ['일점 저격', '꿰뚫는 저격', '폭발하는 화살', '쐐기 화살', '집중 사격', '생명의 흐름', '산들 바람', '얼어붙은 대지'], '저격',
      '결계지 방어에서 멀리서 웨이브 정리하기 좋아요. 헌신 두 개로 생존 보강.', false, 3),
    deck('d4', 'm6', '절명 대인전', '대인',
      ['기습', '약점 베기', '환영 참격', '은신', '얼음 감옥', '쇠사슬 가시', '머리치기', '불굴'], '절명',
      '신기 쟁탈전용. 은신 → 기습으로 진입, 얼음 감옥으로 묶고 마무리합니다.\n제압 3개라 제압 궁극기도 고를 수 있지만 절명이 더 낫습니다.', false, 1),
  ];
  const deckLikes = [
    ...['officer', 'm3', 'member', 'm5', 'm6'].map((m) => ({ deck_id: 'd1', member_id: m })),
    ...['master', 'member', 'm5'].map((m) => ({ deck_id: 'd2', member_id: m })),
    ...['m5', 'm6'].map((m) => ({ deck_id: 'd3', member_id: m })),
    ...['officer', 'm3'].map((m) => ({ deck_id: 'd4', member_id: m })),
  ];
  const guestbook: GuestbookEntry[] = [
    { id: 'g1', author_id: null, name: '지나가던 무사', message: '문파 분위기 좋아 보이네요! 가입 신청하고 갑니다 🙇', created_at: ago(2.2) },
    { id: 'g2', author_id: 'm5', name: '감자전', message: '이번 주 신기 쟁탈전 수고 많으셨습니다~ 다음 주도 화이팅!', created_at: ago(1.1) },
    { id: 'g3', author_id: null, name: '옆 문파 사람', message: '도술덱 정리 잘 되어 있어서 참고하고 갑니다. 강타 덱 좋네요.', created_at: ago(0.2) },
  ];
  return { decks, deckLikes, guestbook };
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch {
    // 저장소를 못 쓰는 환경이면 새 데이터로 시작
  }
  return seed();
}

export function createDemoBackend(): Backend {
  let state = load();
  const listeners = new Set<(s: Session | null) => void>();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 무시: 메모리 상태로 계속 동작
    }
  }

  const tick = () => new Promise((r) => setTimeout(r, 120));
  const me = () => state.profiles.find((p) => p.id === state.session?.userId);
  const isMember = () => !!me()?.approved;
  const isOfficer = () => isMember() && (me()!.role === 'master' || me()!.role === 'officer');
  const isMaster = () => isMember() && me()!.role === 'master';
  const myRosterId = () => state.roster.find((r) => r.active && r.profile_id && r.profile_id === me()?.id)?.id ?? null;
  const officerOnly = (what = '운영진만 할 수 있습니다') => {
    if (!isOfficer()) throw new Error(what);
  };
  const balance = (id: string) => state.coins.filter((c) => c.roster_id === id).reduce((s, c) => s + c.delta, 0);
  const nickOf = (id: string) => state.roster.find((r) => r.id === id)?.nickname ?? '(삭제됨)';

  // 성장 비교 기준: 그 주 이전 마지막 결산 값, 없으면 0 이 아닌 첫 기록
  const basePower = (id: string, beforeWeek?: string): number | null =>
    [...state.settlements]
      .filter((s) => !beforeWeek || s.week < beforeWeek)
      .sort((a, b) => b.week.localeCompare(a.week))
      .map((s) => s.rows.find((r) => r.roster_id === id)?.power)
      .find((v) => v !== undefined) ??
    [...state.history]
      .filter((h) => h.roster_id === id && h.combat_power > 0)
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))[0]?.combat_power ??
    null;

  const weekActs = (week: string): WeekActivities => {
    const out: WeekActivities = {};
    state.activities.filter((a) => a.week === week).forEach((a) => ((out[a.roster_id] ??= {})[a.kind] = a.count));
    return out;
  };

  function preview(week: string): SettlementRow[] {
    const acts = weekActs(week);
    return state.roster
      .filter((r) => r.active)
      .map((r) => ({
        roster_id: r.id,
        nickname: r.nickname,
        prev_power: basePower(r.id, week),
        power: r.combat_power,
        points: activityPoints(acts[r.id], state.guild.activity_points),
        share: 0,
      }))
      .sort((a, b) => b.points - a.points || b.power - a.power);
  }

  function overview(r: RawRoster): RosterMember {
    const base = basePower(r.id);
    // Supabase 와 같게: 엽전은 문파원에게만 보입니다.
    const entries = isMember() ? state.coins.filter((c) => c.roster_id === r.id) : [];
    return {
      ...r,
      prev_power: base,
      growth: r.combat_power - (base ?? r.combat_power),
      coins: entries.reduce((s, c) => s + c.delta, 0),
      earned: entries.filter((c) => c.delta > 0).reduce((s, c) => s + c.delta, 0),
    };
  }

  function accountView(p: Profile): Member {
    // 체험 계정은 닉네임을 정한 상태로 시작
    return { ...p, nickname_confirmed: true };
  }

  // 같은 닉네임의 승인된 계정과 명단을 연결하고, 승인이 풀린 계정은 연결 해제 (schema.sql 의 link 트리거와 같음)
  function relink() {
    state.roster.forEach((r) => {
      const p = state.profiles.find((x) => x.id === r.profile_id);
      if (r.profile_id && !p?.approved) r.profile_id = null;
    });
    state.profiles
      .filter((p) => p.approved && !state.roster.some((r) => r.profile_id === p.id))
      .forEach((p) => {
        const r = state.roster.find((x) => x.nickname === p.nickname && !x.profile_id);
        if (r) r.profile_id = p.id;
      });
  }

  function setPower(r: RawRoster, power: number) {
    if (!(power >= 0)) throw new Error('전투력을 확인해 주세요');
    if (power !== r.combat_power) {
      r.combat_power = power;
      state.history.push({ roster_id: r.id, combat_power: power, recorded_at: new Date().toISOString() });
    }
  }

  function addRoster(nickname: string, rank: Rank, power: number, active = true): RawRoster {
    const r: RawRoster = { id: uid(), nickname, rank, combat_power: power, active, profile_id: null, created_at: new Date().toISOString() };
    state.roster.push(r);
    state.history.push({ roster_id: r.id, combat_power: power, recorded_at: r.created_at });
    return r;
  }

  function emit() {
    listeners.forEach((cb) => cb(state.session));
  }

  return {
    mode: 'demo',

    async getSession() {
      return state.session;
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn(email) {
      await tick();
      const id = email.replace('@demo', '');
      if (!state.profiles.some((p) => p.id === id)) {
        throw new Error('체험 모드에서는 아래 체험 계정 버튼으로 로그인하세요');
      }
      state.session = { userId: id, email };
      save();
      emit();
    },
    async signUp(email, _password, nickname) {
      await tick();
      if (state.profiles.some((p) => p.nickname === nickname)) throw new Error('이미 사용 중인 닉네임입니다');
      const id = uid();
      state.profiles.push({ id, nickname, role: 'member', approved: false, joined_at: new Date().toISOString() });
      state.session = { userId: id, email };
      save();
      emit();
      return { needsConfirm: false };
    },
    async signInWithGoogle() {
      throw new Error('체험 모드에서는 구글 로그인을 쓸 수 없습니다. 아래 체험 계정 버튼으로 둘러보세요');
    },
    async signOut() {
      state.session = null;
      save();
      emit();
    },

    async getGuild() {
      await tick();
      return { ...state.guild };
    },
    async updateGuild(patch) {
      await tick();
      officerOnly('운영진만 수정할 수 있습니다');
      const rulesChanged =
        (patch.activity_points && JSON.stringify(patch.activity_points) !== JSON.stringify(state.guild.activity_points)) ||
        (patch.weekly_bonus && JSON.stringify(patch.weekly_bonus) !== JSON.stringify(state.guild.weekly_bonus));
      if (rulesChanged && !isMaster()) throw new Error('점수·보너스 기준은 문주만 바꿀 수 있습니다');
      const before = state.guild;
      state.guild = { ...state.guild, ...patch };
      if (patch.coins !== undefined && patch.coins !== before.coins) state.guild.coins_at = new Date().toISOString();
      save();
    },

    async listMembers() {
      await tick();
      const visible = state.session ? state.profiles : state.profiles.filter((p) => p.approved);
      return visible.map(accountView);
    },
    async getMember(id) {
      const p = state.profiles.find((x) => x.id === id);
      return p ? accountView(p) : null;
    },
    async updateMyProfile(patch) {
      await tick();
      const p = me();
      if (!p) throw new Error('로그인이 필요합니다');
      const nickname = patch.nickname.trim();
      if (state.profiles.some((x) => x.id !== p.id && x.nickname === nickname)) {
        throw new Error('이미 사용 중인 닉네임입니다');
      }
      p.nickname = nickname;
      relink();
      save();
    },
    async adminUpdateMember(id, patch) {
      await tick();
      const p = state.profiles.find((x) => x.id === id);
      if (!p) throw new Error('없는 계정입니다');
      officerOnly();
      const touchesMasterInfo =
        (patch.role !== undefined && patch.role !== p.role) || (patch.approved !== undefined && patch.approved !== p.approved);
      if (p.role === 'master' && p.id !== me()!.id && !isMaster() && touchesMasterInfo) {
        throw new Error('문주 정보는 문주만 바꿀 수 있습니다');
      }
      if (patch.role !== undefined && patch.role !== p.role && !isMaster()) throw new Error('직책 변경은 문주만 할 수 있습니다');
      const losesMaster = p.role === 'master' && ((patch.role && patch.role !== 'master') || patch.approved === false);
      if (losesMaster && !state.profiles.some((x) => x.id !== p.id && x.role === 'master' && x.approved)) {
        throw new Error('문주가 최소 한 명은 있어야 합니다. 다른 사람을 먼저 문주로 지정하세요');
      }
      if (patch.role !== undefined) p.role = patch.role;
      if (patch.approved !== undefined) p.approved = patch.approved;
      relink();
      save();
    },

    async listRoster() {
      await tick();
      return state.roster.map(overview).sort((a, b) => b.combat_power - a.combat_power);
    },
    async saveRoster({ id, ...fields }) {
      await tick();
      officerOnly('운영진만 명단을 관리할 수 있습니다');
      const nickname = fields.nickname.trim();
      if (!nickname || nickname.length > 20) throw new Error('닉네임은 1~20자로 적어 주세요');
      if (state.roster.some((r) => r.id !== id && r.nickname === nickname)) throw new Error('이미 명단에 있는 닉네임입니다');
      if (id) {
        const r = state.roster.find((x) => x.id === id);
        if (!r) throw new Error('없는 문파원입니다');
        if (r.nickname !== nickname) {
          r.nickname = nickname;
        }
        r.rank = fields.rank;
        r.active = fields.active;
        setPower(r, fields.combat_power);
      } else {
        addRoster(nickname, fields.rank, fields.combat_power, fields.active);
      }
      relink();
      save();
    },
    async deleteRoster(id) {
      await tick();
      officerOnly('운영진만 명단을 관리할 수 있습니다');
      state.roster = state.roster.filter((r) => r.id !== id);
      state.history = state.history.filter((h) => h.roster_id !== id);
      state.activities = state.activities.filter((a) => a.roster_id !== id);
      state.coins = state.coins.filter((c) => c.roster_id !== id);
      state.requests = state.requests.filter((r) => r.roster_id !== id);
      state.settlements.forEach((s) => (s.rows = s.rows.filter((r) => r.roster_id !== id)));
      save();
    },
    async linkRoster(rosterId, profileId) {
      await tick();
      officerOnly();
      const r = state.roster.find((x) => x.id === rosterId);
      if (!r) throw new Error('없는 문파원입니다');
      if (profileId && state.roster.some((x) => x.id !== rosterId && x.profile_id === profileId)) {
        throw new Error('이 계정은 이미 다른 명단과 연결되어 있습니다');
      }
      r.profile_id = profileId;
      save();
    },
    async importRoster(rows) {
      await tick();
      officerOnly('운영진만 명단을 관리할 수 있습니다');
      let added = 0;
      const now = new Date().toISOString();
      for (const row of rows) {
        const nickname = row.nickname.trim();
        let r = state.roster.find((x) => x.nickname === nickname);
        if (r) {
          r.rank = row.rank;
          setPower(r, row.combat_power);
        } else {
          r = addRoster(nickname, row.rank, row.combat_power);
          added++;
        }
        const diff = row.coins === null ? 0 : row.coins - balance(r.id);
        if (diff !== 0) {
          state.coins.push({ id: uid(), roster_id: r.id, delta: diff, kind: 'adjust', week: null, reason: '명단 가져오기 (누적엽전 맞춤)', created_at: now });
        }
      }
      relink();
      save();
      return { added, updated: rows.length - added };
    },
    async setPowers(updates) {
      await tick();
      officerOnly('전투력은 운영진이 게임 화면으로 갱신합니다');
      updates.forEach((u) => {
        const r = state.roster.find((x) => x.id === u.id);
        if (r) setPower(r, u.combat_power);
      });
      save();
    },

    async listActivities(week) {
      await tick();
      if (!isMember()) return {};
      return weekActs(week);
    },
    async setActivity(rosterId, kind, week, count) {
      officerOnly('운영진만 기록할 수 있습니다');
      if (week !== weekStart(week)) throw new Error('주 시작일(수요일)이 아닙니다');
      if (count < 0 || count > 50 || (kind !== 'discord' && count > 1)) throw new Error('참여 횟수를 확인해 주세요');
      state.activities = state.activities.filter((a) => !(a.roster_id === rosterId && a.kind === kind && a.week === week));
      if (count > 0) state.activities.push({ roster_id: rosterId, kind, week, count });
      save();
    },

    async listCoins(rosterId) {
      await tick();
      if (!isMember()) return [];
      return state.coins
        .filter((c) => !rosterId || c.roster_id === rosterId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async adjustCoins(rosterIds, delta, reason) {
      await tick();
      officerOnly('운영진만 조정할 수 있습니다');
      if (!delta) throw new Error('엽전을 적어 주세요');
      const now = new Date().toISOString();
      rosterIds.forEach((roster_id) => state.coins.push({ id: uid(), roster_id, delta, kind: 'adjust', week: null, reason, created_at: now }));
      save();
    },

    async listSettlements() {
      await tick();
      return [...state.settlements]
        .sort((a, b) => b.week.localeCompare(a.week))
        .slice(0, 12)
        .map((s) => ({
          ...s,
          rows: s.rows.map((r) => ({ ...r, nickname: nickOf(r.roster_id) })).sort((a, b) => b.points - a.points || b.power - a.power),
        }));
    },
    async previewWeek(week) {
      await tick();
      return preview(weekStart(week));
    },
    async settleWeek(date, pool) {
      await tick();
      officerOnly('운영진만 결산할 수 있습니다');
      if (!(pool >= 0)) throw new Error('이번 주 문파 엽전을 확인해 주세요');
      const week = weekStart(date);
      if (week > weekStart(today())) throw new Error('아직 시작하지 않은 주입니다');
      if (state.settlements.some((s) => s.week >= week)) throw new Error('이미 결산한 주이거나, 더 최근 주가 결산되어 있습니다');
      const now = new Date().toISOString();
      const rows = withShares(preview(week), Math.floor(pool)).map(({ nickname: _, ...r }) => r);
      const guild_coins = state.guild.coins_at ? state.guild.coins : null;
      state.settlements.push({ week, pool: Math.floor(pool), total_points: rows.reduce((s, r) => s + r.points, 0), guild_coins, settled_at: now, rows });
      state.coins.push(...settlementCoins(week, rows, state.guild.weekly_bonus, now));
      save();
    },
    async cancelSettlement(week) {
      await tick();
      officerOnly('운영진만 취소할 수 있습니다');
      if (!state.settlements.some((s) => s.week === week) || state.settlements.some((s) => s.week > week)) {
        throw new Error('가장 최근 결산만 취소할 수 있습니다');
      }
      state.settlements = state.settlements.filter((s) => s.week !== week);
      state.coins = state.coins.filter((c) => !(c.week === week && c.kind !== 'warehouse' && c.kind !== 'adjust'));
      save();
    },

    async listItems() {
      await tick();
      if (!isMember()) return [];
      return [...state.items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    },
    async saveItem(item) {
      await tick();
      officerOnly('운영진만 관리할 수 있습니다');
      if (item.id) {
        state.items = state.items.map((i) => (i.id === item.id ? { ...i, ...item, id: i.id } : i));
      } else {
        state.items.push({ ...item, id: uid() });
      }
      save();
    },

    async listRequests(rosterId) {
      await tick();
      if (!me()) return [];
      const mine = myRosterId();
      return state.requests
        .filter((r) => (rosterId ? r.roster_id === rosterId : true))
        .filter((r) => isOfficer() || (mine && r.roster_id === mine))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r): ItemRequest => {
          const item = state.items.find((i) => i.id === r.item_id);
          return { ...r, nickname: nickOf(r.roster_id), item_name: item?.name ?? '(삭제된 아이템)', item_icon: item?.icon ?? '📦' };
        });
    },
    async requestItem(itemId, quantity, note) {
      await tick();
      if (!isMember()) throw new Error('승인된 문파원만 신청할 수 있습니다');
      const rid = myRosterId();
      if (!rid) throw new Error('문파원 명단과 연결되지 않은 계정입니다. 운영진에게 연결을 요청하세요');
      if (!(quantity >= 1)) throw new Error('수량을 확인해 주세요');
      const item = state.items.find((i) => i.id === itemId && i.active);
      if (!item) throw new Error('창고에 없는 아이템입니다');
      if (item.stock < quantity) throw new Error('창고 재고가 부족합니다');
      const pending = state.requests.filter((r) => r.roster_id === rid && r.status === 'pending').reduce((s, r) => s + r.total_cost, 0);
      if (balance(rid) - pending < item.cost * quantity) throw new Error('엽전이 부족합니다');
      state.requests.push({
        id: uid(), roster_id: rid, item_id: itemId, quantity, total_cost: item.cost * quantity,
        status: 'pending', note, created_at: new Date().toISOString(), decided_at: null,
      });
      save();
    },
    async decideRequest(id, approve) {
      await tick();
      officerOnly('운영진만 처리할 수 있습니다');
      const r = state.requests.find((x) => x.id === id);
      if (!r || r.status !== 'pending') throw new Error('이미 처리된 신청입니다');
      if (approve) {
        const item = state.items.find((i) => i.id === r.item_id)!;
        if (item.stock < r.quantity) throw new Error('창고 재고가 부족합니다');
        if (balance(r.roster_id) < r.total_cost) throw new Error('신청자의 엽전이 부족합니다');
        item.stock -= r.quantity;
        if (r.total_cost > 0) {
          state.coins.push({
            id: uid(), roster_id: r.roster_id, delta: -r.total_cost, kind: 'warehouse', week: null,
            reason: `${item.name} x${r.quantity}`, created_at: new Date().toISOString(),
          });
        }
      }
      r.status = approve ? 'approved' : 'rejected';
      r.decided_at = new Date().toISOString();
      save();
    },
    async cancelRequest(id) {
      await tick();
      const r = state.requests.find((x) => x.id === id);
      if (!r || !r.roster_id || r.roster_id !== myRosterId() || r.status !== 'pending') throw new Error('취소할 수 없는 신청입니다');
      r.status = 'cancelled';
      r.decided_at = new Date().toISOString();
      save();
    },

    async listDecks() {
      await tick();
      return state.decks.map(deckView).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getDeck(id) {
      await tick();
      const d = state.decks.find((x) => x.id === id);
      return d ? deckView(d) : null;
    },
    async saveDeck({ id, ...fields }) {
      await tick();
      if (!isMember()) throw new Error('승인된 문파원만 덱을 올릴 수 있습니다');
      if (!fields.title.trim()) throw new Error('덱 이름을 적어 주세요');
      const now = new Date().toISOString();
      if (id) {
        const d = state.decks.find((x) => x.id === id);
        if (!d) throw new Error('없는 덱입니다');
        if (d.author_id !== me()!.id && !isOfficer()) throw new Error('내가 올린 덱만 고칠 수 있습니다');
        Object.assign(d, fields, { updated_at: now });
        save();
        return id;
      }
      const newId = uid();
      state.decks.push({ ...fields, id: newId, author_id: me()!.id, guild_pick: false, created_at: now, updated_at: now });
      save();
      return newId;
    },
    async deleteDeck(id) {
      await tick();
      const d = state.decks.find((x) => x.id === id);
      if (!d) return;
      if (d.author_id !== me()?.id && !isOfficer()) throw new Error('내가 올린 덱만 지울 수 있습니다');
      state.decks = state.decks.filter((x) => x.id !== id);
      state.deckLikes = state.deckLikes.filter((l) => l.deck_id !== id);
      save();
    },
    async setDeckLike(id, liked) {
      await tick();
      if (!isMember()) throw new Error('문파원만 추천할 수 있습니다');
      const mine = me()!.id;
      state.deckLikes = state.deckLikes.filter((l) => !(l.deck_id === id && l.member_id === mine));
      if (liked) state.deckLikes.push({ deck_id: id, member_id: mine });
      save();
    },
    async setGuildPick(id, pick) {
      await tick();
      if (!isOfficer()) throw new Error('문파 추천은 운영진만 지정할 수 있습니다');
      const d = state.decks.find((x) => x.id === id);
      if (d) d.guild_pick = pick;
      save();
    },

    async listGuestbook() {
      await tick();
      return [...state.guestbook].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async addGuestbook(name, message) {
      await tick();
      const n = name.trim();
      const m = message.trim();
      if (!n || n.length > 20) throw new Error('이름은 1~20자로 적어 주세요');
      if (!m || m.length > 500) throw new Error('내용은 1~500자로 적어 주세요');
      const recent = state.guestbook.some((g) => g.name === n && Date.now() - Date.parse(g.created_at) < 30_000);
      if (recent) throw new Error('잠시 후 다시 남겨 주세요');
      state.guestbook.push({ id: uid(), author_id: me()?.id ?? null, name: n, message: m, created_at: new Date().toISOString() });
      save();
    },
    async deleteGuestbook(id) {
      await tick();
      const g = state.guestbook.find((x) => x.id === id);
      if (!g) return;
      if (g.author_id !== me()?.id && !isOfficer()) throw new Error('내가 쓴 글만 지울 수 있습니다');
      state.guestbook = state.guestbook.filter((x) => x.id !== id);
      save();
    },

    async recordVisit(visitorId) {
      const day = today();
      if (!state.visits.some((v) => v.day === day && v.visitor === visitorId)) {
        state.visits.push({ day, visitor: visitorId });
        save();
      }
    },
    async getVisitStats() {
      // 체험 모드: 예시 누적값 + 이 브라우저에서 센 방문
      const day = today();
      return {
        today: DEMO_VISITS.today + state.visits.filter((v) => v.day === day).length,
        total: DEMO_VISITS.total + state.visits.length,
      };
    },
  };

  function deckView(d: RawDeck): Deck {
    const likes = state.deckLikes.filter((l) => l.deck_id === d.id);
    return {
      ...d,
      author_nickname: state.profiles.find((p) => p.id === d.author_id)?.nickname ?? null,
      like_count: likes.length,
      liked_by_me: likes.some((l) => l.member_id === state.session?.userId),
    };
  }
}

const DEMO_VISITS = { today: 23, total: 1_482 };

export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
  window.location.reload();
}
