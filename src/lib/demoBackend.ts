// Supabase 연결 전에 화면을 미리 써 볼 수 있는 체험용 백엔드.
// 데이터는 이 브라우저의 localStorage 에만 저장되며, 권한 규칙은 supabase/schema.sql 과 같게 맞춰 두었습니다.
import {
  DEFAULT_ACTIVITY_POINTS,
  DEFAULT_POWER_TIERS,
  DEFAULT_WEEKLY_BONUS,
  KIND_LABEL,
  powerScore,
  weekWinners,
  type ActivityKey,
  type Backend,
  type Deck,
  type GuestbookEntry,
  type Guild,
  type Item,
  type ItemRequest,
  type LedgerEntry,
  type Member,
  type PointKind,
  type PowerWeekRow,
  type RequestStatus,
  type Role,
  type Session,
} from './types';
import { addDays, shortDate, today, weekStart } from './week';

interface Profile {
  id: string;
  nickname: string;
  combat_power: number;
  role: Role;
  approved: boolean;
  joined_at: string;
}

interface RawRequest {
  id: string;
  member_id: string;
  item_id: string;
  quantity: number;
  total_cost: number;
  status: RequestStatus;
  note: string;
  created_at: string;
  decided_at: string | null;
}

type RawDeck = Omit<Deck, 'author_nickname' | 'like_count' | 'liked_by_me'>;

type RawWeekRow = Omit<PowerWeekRow, 'nickname'>;
interface RawWeek {
  week: string;
  settled_at: string;
  rows: RawWeekRow[];
}

interface DemoState {
  guild: Guild;
  profiles: Profile[];
  history: { member_id: string; combat_power: number; recorded_at: string }[];
  ledger: LedgerEntry[];
  powerWeeks: RawWeek[];
  items: Item[];
  requests: RawRequest[];
  decks: RawDeck[];
  deckLikes: { deck_id: string; member_id: string }[];
  guestbook: GuestbookEntry[];
  visits: { day: string; visitor: string }[];
  session: Session | null;
}

// 데이터 구조가 바뀌면 버전을 올려 예전 체험 데이터를 새로 시작합니다.
const STORAGE_KEY = 'dokkaebi-guild-demo-v8';
const DAY = 86_400_000;

export const DEMO_ACCOUNTS = [
  { email: 'master@demo', label: '문주로 둘러보기', desc: '모든 관리 기능' },
  { email: 'officer@demo', label: '부문주로 둘러보기', desc: '승인·참여 기록·창고 관리' },
  { email: 'member@demo', label: '문파원으로 둘러보기', desc: '창고 신청·내 정보' },
  { email: 'pending@demo', label: '가입 대기자로 둘러보기', desc: '승인 전 화면' },
];

function ago(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}


function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 결산 보너스 원장 줄 (schema.sql 의 settle_power_week 와 같은 규칙) */
function settlementLedger(week: string, rows: RawWeekRow[], bonus: Guild['weekly_bonus'], created_at: string): LedgerEntry[] {
  const w = weekWinners(rows.map((r) => ({ ...r, nickname: '' })));
  const label = `${shortDate(week)} 주`;
  const out: LedgerEntry[] = [];
  if (bonus.top_power > 0)
    w.powerIds.forEach((member_id) =>
      out.push({ id: uid(), member_id, delta: bonus.top_power, kind: 'top_power', reason: `주간 최고 전투력 ${label} (${w.topPower.toLocaleString('ko-KR')})`, activity_date: week, created_at }),
    );
  if (bonus.top_growth > 0)
    w.growthIds.forEach((member_id) =>
      out.push({ id: uid(), member_id, delta: bonus.top_growth, kind: 'top_growth', reason: `주간 최고 성장 ${label} (+${w.topGrowth.toLocaleString('ko-KR')})`, activity_date: week, created_at }),
    );
  return out;
}

function seed(): DemoState {
  const people: [string, string, Role, number, number, boolean][] = [
    // id, 닉네임, 직책, 현재 전투력, 7일 전 전투력, 승인
    ['master', '청사초롱', 'master', 48_210, 45_900, true],
    ['officer', '달빛방망이', 'officer', 45_870, 44_100, true],
    ['m3', '홍련', 'officer', 44_320, 43_950, true],
    ['member', '푸른도깨비불', 'member', 39_650, 36_200, true],
    ['m5', '감자전', 'member', 38_100, 37_400, true],
    ['m6', '은하수', 'member', 36_480, 33_900, true],
    ['m7', '먹구름', 'member', 33_020, 32_870, true],
    ['m8', '호랑이담배', 'member', 31_760, 29_010, true],
    ['m9', '솔바람', 'member', 29_400, 28_800, true],
    ['m10', '도토리묵', 'member', 27_150, 24_300, true],
    ['m11', '새벽별', 'member', 24_980, 24_100, true],
    ['m12', '깨비깨비', 'member', 21_300, 18_750, true],
    ['pending', '떠돌이무사', 'member', 19_800, 19_800, false],
  ];

  const profiles: Profile[] = people.map(([id, nickname, role, power, , approved], i) => ({
    id,
    nickname,
    combat_power: power,
    role,
    approved,
    joined_at: ago(approved ? 120 - i * 7 : 1),
  }));

  const history = people.flatMap(([id, , , power, before, approved]) =>
    approved
      ? [
          { member_id: id, combat_power: before, recorded_at: ago(9) },
          { member_id: id, combat_power: power, recorded_at: ago(1) },
        ]
      : [{ member_id: id, combat_power: power, recorded_at: ago(1) }],
  );

  const ledger: LedgerEntry[] = [];
  const add = (member_id: string, delta: number, kind: PointKind, reason: string, days: number, activity_date: string | null = null) =>
    ledger.push({ id: uid(), member_id, delta, kind, reason, activity_date, created_at: ago(days) });

  // 지난 2주 + 이번 주 활동 참여 기록. 각 활동은 주 1회 (수요일 시작 기준 요일 오프셋)
  const DAY_IN_WEEK: Record<ActivityKey, number> = { yosin: 1, barrier: 3, garden: 4, singi: 5 };
  const thisWeek = weekStart(today());
  const sessions: [ActivityKey, string][] = [];
  for (const w of [-14, -7, 0]) {
    for (const kind of Object.keys(DAY_IN_WEEK) as ActivityKey[]) {
      const date = addDays(thisWeek, w + DAY_IN_WEEK[kind]);
      if (date <= today()) sessions.push([kind, date]);
    }
  }
  const daysAgo = (ymd: string) => Math.round((Date.parse(today()) - Date.parse(ymd)) / DAY);
  people.forEach(([id, , , , , approved], i) => {
    if (!approved) return;
    sessions.forEach(([kind, date], s) => {
      if ((i + s) % 4 === 3) return; // 가끔 빠짐
      add(id, DEFAULT_ACTIVITY_POINTS[kind], kind, `${KIND_LABEL[kind]} ${shortDate(date)}`, daysAgo(date), date);
    });
  });
  add('member', -60, 'warehouse', '용맹의 강타 도술 조각 선택 상자 x1', 4);

  // 2주 전 주간 결산 (그때 전투력 = 7일 전 값). 지난 주는 아직 결산 전이라 관리 화면에서 해 볼 수 있음
  const settledWeek = addDays(thisWeek, -14);
  const powerWeeks: RawWeek[] = [
    {
      week: settledWeek,
      settled_at: ago(daysAgo(settledWeek) - 6),
      rows: people
        .filter(([, , , , , approved]) => approved)
        .map(([id, , , , before], i) => ({ member_id: id, prev_power: before - 300 - ((i * 677) % 1900), power: before })),
    },
  ];
  ledger.push(...settlementLedger(settledWeek, powerWeeks[0].rows, DEFAULT_WEEKLY_BONUS, powerWeeks[0].settled_at));

  // 문파 상점에서 사서 문파 창고에 넣어 둔 물품 (가격은 기여 점수 기준)
  const items: Item[] = [
    ['용맹의 강타 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '강타 도술 조각 중 하나를 골라 받는 상자', 4, 60],
    ['용맹의 연타 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '연타 도술 조각 중 하나를 골라 받는 상자', 3, 60],
    ['용맹의 저격 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '저격 도술 조각 중 하나를 골라 받는 상자', 3, 60],
    ['용맹의 결명 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '결명 도술 조각 중 하나를 골라 받는 상자', 2, 60],
    ['용맹의 강인 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '강인 도술 조각 중 하나를 골라 받는 상자', 2, 60],
    ['용맹의 파멸 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '파멸 도술 조각 중 하나를 골라 받는 상자', 2, 60],
    ['용맹의 현신 도술 조각 선택 상자', '도술 조각', 'img:skill-select', '현신 도술 조각 중 하나를 골라 받는 상자', 1, 60],
    ['용맹의 특별 도술 조각 랜덤 상자', '도술 조각', 'img:special-random', '특별 도술 조각 하나가 무작위로 나오는 상자', 2, 100],
    ['용맹의 특별 도술 조각 선택 상자', '도술 조각', 'img:special-select', '특별 도술 조각 중 하나를 골라 받는 상자', 1, 300],
    ['영웅 무기 도안 선택 상자', '도안', '📜', '영웅 등급 무기 도안 선택 (문파 Lv.7 상품)', 3, 120],
    ['산척의 방어구 도안 선택 상자', '도안', '📜', '영웅 등급 방어구 도안 선택 (문파 Lv.7 상품)', 3, 120],
    ['영웅 장신구 도안 선택 상자', '도안', '📜', '영웅 등급 장신구 도안 선택 (문파 Lv.7 상품)', 2, 120],
    ['전설 무기 도안 선택 상자', '도안', '🗡️', '전설 등급 무기 도안 선택 (문파 Lv.20 상품)', 0, 400],
    ['희귀 가호의 정수', '가호', 'img:rare-essence', '가호 강화 재료 (희귀)', 60, 2],
    ['영웅 가호의 정수', '가호', 'img:hero-essence', '가호 강화 재료 (영웅)', 25, 8],
    ['전설 가호의 정수', '가호', 'img:legend-essence', '가호 강화 재료 (전설)', 8, 25],
    ['가호 주머니', '가호', 'img:pouch', '가호를 얻을 수 있는 주머니', 12, 15],
    ['요혼석', '소모품', 'img:yohonseok', '문파 상점 요혼석', 150, 2],
    ['특급 체력 회복 물약', '소모품', 'img:potion', '사냥·전장용 특급 체력 회복 물약', 40, 3],
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
    {
      id: uid(), member_id: 'member', item_id: items[0].id, quantity: 1, total_cost: 60,
      status: 'approved', note: '강타 세팅용', created_at: ago(5), decided_at: ago(4),
    },
    {
      id: uid(), member_id: 'member', item_id: items[15].id, quantity: 2, total_cost: 50,
      status: 'pending', note: '', created_at: ago(0.3), decided_at: null,
    },
    {
      id: uid(), member_id: 'm6', item_id: items[9].id, quantity: 1, total_cost: 120,
      status: 'pending', note: '무기 교체', created_at: ago(0.1), decided_at: null,
    },
  ];

  const { decks, deckLikes, guestbook } = seedDecks();

  return {
    guild: {
      name: '우리 문파',
      level: 7,
      motto: '함께 사냥하고, 함께 강해진다',
      notice:
        '이번 주 토요일 밤 9시 신기 쟁탈전에 모두 모여 주세요. 참여하면 기여 점수 20점!\n전투력은 매주 화요일 밤 운영진이 문파원 목록 캡처로 갱신합니다. 주간 최고 전투력·최고 성장에게는 보너스 점수가 있어요.',
      recruiting: true,
      power_tiers: DEFAULT_POWER_TIERS,
      activity_points: DEFAULT_ACTIVITY_POINTS,
      weekly_bonus: DEFAULT_WEEKLY_BONUS,
    },
    profiles,
    history,
    ledger,
    powerWeeks,
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
    ...['officer', 'm3', 'member', 'm5', 'm6', 'm8'].map((m) => ({ deck_id: 'd1', member_id: m })),
    ...['master', 'member', 'm7', 'm9'].map((m) => ({ deck_id: 'd2', member_id: m })),
    ...['m5', 'm10'].map((m) => ({ deck_id: 'd3', member_id: m })),
    ...['officer', 'm3', 'm8'].map((m) => ({ deck_id: 'd4', member_id: m })),
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
  const ledgerOf = (id: string) => state.ledger.filter((l) => l.member_id === id);
  const sum = (entries: LedgerEntry[]) => entries.reduce((s, l) => s + l.delta, 0);
  const scoreOf = (p: Profile) => powerScore(p.combat_power, state.guild.power_tiers);
  const balance = (id: string) => {
    const p = state.profiles.find((x) => x.id === id);
    return p ? scoreOf(p) + sum(ledgerOf(id)) : 0;
  };

  // 그 주 시작 전에 마지막으로 기록된 0 이 아닌 전투력
  const powerBefore = (id: string, week: string) =>
    state.history
      .filter((h) => h.member_id === id && h.combat_power > 0 && h.recorded_at < new Date(`${week}T00:00:00`).toISOString())
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.combat_power;
  // 그 주보다 앞선 가장 최근 결산 값
  const lastSettled = (id: string, beforeWeek?: string) =>
    [...state.powerWeeks]
      .filter((w) => !beforeWeek || w.week < beforeWeek)
      .sort((a, b) => b.week.localeCompare(a.week))
      .map((w) => w.rows.find((r) => r.member_id === id)?.power)
      .find((v) => v !== undefined);

  function preview(week: string): PowerWeekRow[] {
    return state.profiles
      .filter((p) => p.approved && p.combat_power > 0)
      .map((p) => ({
        member_id: p.id,
        nickname: p.nickname,
        prev_power: lastSettled(p.id, week) ?? powerBefore(p.id, week) ?? null,
        power: p.combat_power,
      }))
      .sort((a, b) => b.power - a.power);
  }

  function overview(p: Profile): Member {
    const base = lastSettled(p.id) ?? powerBefore(p.id, weekStart(today())) ?? p.combat_power;
    // Supabase 와 같게: 원장(활동·사용)은 문파원에게만 보입니다.
    const entries = isMember() ? ledgerOf(p.id) : [];
    return {
      ...p,
      power_score: scoreOf(p),
      activity_score: sum(entries.filter((l) => l.kind !== 'warehouse')),
      points: scoreOf(p) + sum(entries),
      growth_week: p.combat_power - base,
      // 체험 계정은 닉네임을 정한 상태로 시작
      nickname_confirmed: true,
    };
  }

  function setPower(p: Profile, power: number) {
    if (power !== p.combat_power) {
      p.combat_power = power;
      state.history.push({ member_id: p.id, combat_power: power, recorded_at: new Date().toISOString() });
    }
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
      state.profiles.push({
        id, nickname, combat_power: 0, role: 'member', approved: false, joined_at: new Date().toISOString(),
      });
      state.history.push({ member_id: id, combat_power: 0, recorded_at: new Date().toISOString() });
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
      if (!isOfficer()) throw new Error('운영진만 수정할 수 있습니다');
      const rulesChanged =
        (patch.power_tiers && JSON.stringify(patch.power_tiers) !== JSON.stringify(state.guild.power_tiers)) ||
        (patch.activity_points && JSON.stringify(patch.activity_points) !== JSON.stringify(state.guild.activity_points)) ||
        (patch.weekly_bonus && JSON.stringify(patch.weekly_bonus) !== JSON.stringify(state.guild.weekly_bonus));
      if (rulesChanged && !isMaster()) throw new Error('점수 기준은 문주만 바꿀 수 있습니다');
      state.guild = { ...state.guild, ...patch };
      save();
    },

    async listMembers() {
      await tick();
      const visible = state.session ? state.profiles : state.profiles.filter((p) => p.approved);
      return visible.map(overview).sort((a, b) => b.combat_power - a.combat_power);
    },
    async getMember(id) {
      const p = state.profiles.find((x) => x.id === id);
      return p ? overview(p) : null;
    },
    async updateMyProfile(patch) {
      await tick();
      const p = me();
      if (!p) throw new Error('로그인이 필요합니다');
      if (state.profiles.some((x) => x.id !== p.id && x.nickname === patch.nickname)) {
        throw new Error('이미 사용 중인 닉네임입니다');
      }
      p.nickname = patch.nickname;
      save();
    },
    async adminUpdateMember(id, patch) {
      await tick();
      const p = state.profiles.find((x) => x.id === id);
      if (!p) throw new Error('없는 문파원입니다');
      if (!isOfficer()) throw new Error('운영진만 할 수 있습니다');
      // 운영진은 문주의 전투력은 갱신할 수 있지만, 직책·승인은 바꿀 수 없음 (schema.sql 의 guard_profile 과 같음)
      const touchesMasterInfo =
        (patch.role !== undefined && patch.role !== p.role) || (patch.approved !== undefined && patch.approved !== p.approved);
      if (p.role === 'master' && p.id !== me()!.id && !isMaster() && touchesMasterInfo) {
        throw new Error('문주 정보는 문주만 바꿀 수 있습니다');
      }
      if (patch.role !== undefined && patch.role !== p.role && !isMaster()) throw new Error('직책 변경은 문주만 할 수 있습니다');
      const losesMaster =
        p.role === 'master' && ((patch.role && patch.role !== 'master') || patch.approved === false);
      if (losesMaster && !state.profiles.some((x) => x.id !== p.id && x.role === 'master' && x.approved)) {
        throw new Error('문주가 최소 한 명은 있어야 합니다. 다른 사람을 먼저 문주로 지정하세요');
      }
      if (patch.role !== undefined) p.role = patch.role;
      if (patch.approved !== undefined) p.approved = patch.approved;
      if (patch.combat_power !== undefined) setPower(p, patch.combat_power);
      save();
    },

    async listLedger(memberId) {
      await tick();
      if (!isMember()) return [];
      return state.ledger
        .filter((l) => !memberId || l.member_id === memberId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async grantPoints(memberIds, delta, kind, reason, activityDate) {
      await tick();
      if (!isOfficer()) throw new Error('운영진만 지급할 수 있습니다');
      if (kind === 'warehouse') throw new Error('창고 차감은 신청 승인으로만 처리됩니다');
      if (kind === 'top_power' || kind === 'top_growth') throw new Error('주간 보너스는 주간 결산으로만 지급됩니다');
      const isActivity = kind !== 'adjust';
      if (isActivity !== !!activityDate) throw new Error('활동 기록에는 참여 날짜가 필요합니다');
      if (isActivity) {
        const week = weekStart(activityDate!);
        const dup = state.ledger.some(
          (l) => memberIds.includes(l.member_id) && l.kind === kind && l.activity_date && weekStart(l.activity_date) === week,
        );
        if (dup) throw new Error('이번 주에 이미 기록된 문파원이 있습니다. 새로고침 후 다시 확인해 주세요');
      }
      const now = new Date().toISOString();
      memberIds.forEach((member_id) =>
        state.ledger.push({ id: uid(), member_id, delta, kind, reason, activity_date: isActivity ? activityDate! : null, created_at: now }),
      );
      save();
    },

    async listPowerWeeks() {
      await tick();
      const nick = (id: string) => state.profiles.find((p) => p.id === id)?.nickname ?? '(탈퇴)';
      return [...state.powerWeeks]
        .sort((a, b) => b.week.localeCompare(a.week))
        .slice(0, 12)
        .map((w) => ({ ...w, rows: w.rows.map((r) => ({ ...r, nickname: nick(r.member_id) })).sort((a, b) => b.power - a.power) }));
    },
    async previewPowerWeek(week) {
      await tick();
      return preview(weekStart(week));
    },
    async settlePowerWeek(date) {
      await tick();
      if (!isOfficer()) throw new Error('운영진만 결산할 수 있습니다');
      const week = weekStart(date);
      if (week > weekStart(today())) throw new Error('아직 시작하지 않은 주입니다');
      if (state.powerWeeks.some((w) => w.week >= week)) throw new Error('이미 결산한 주이거나, 더 최근 주가 결산되어 있습니다');
      const now = new Date().toISOString();
      const rows = preview(week).map(({ nickname: _, ...r }) => r);
      state.powerWeeks.push({ week, settled_at: now, rows });
      state.ledger.push(...settlementLedger(week, rows, state.guild.weekly_bonus, now));
      save();
    },
    async cancelPowerWeek(week) {
      await tick();
      if (!isOfficer()) throw new Error('운영진만 취소할 수 있습니다');
      if (!state.powerWeeks.some((w) => w.week === week) || state.powerWeeks.some((w) => w.week > week)) {
        throw new Error('가장 최근 결산만 취소할 수 있습니다');
      }
      state.powerWeeks = state.powerWeeks.filter((w) => w.week !== week);
      state.ledger = state.ledger.filter((l) => !((l.kind === 'top_power' || l.kind === 'top_growth') && l.activity_date === week));
      save();
    },

    async listItems() {
      await tick();
      if (!isMember()) return [];
      return [...state.items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    },
    async saveItem(item) {
      await tick();
      if (!isOfficer()) throw new Error('운영진만 관리할 수 있습니다');
      if (item.id) {
        state.items = state.items.map((i) => (i.id === item.id ? { ...i, ...item, id: i.id } : i));
      } else {
        state.items.push({ ...item, id: uid() });
      }
      save();
    },

    async listRequests(memberId) {
      await tick();
      const mine = me();
      if (!mine) return [];
      return state.requests
        .filter((r) => (memberId ? r.member_id === memberId : true))
        .filter((r) => isOfficer() || r.member_id === mine.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r): ItemRequest => {
          const item = state.items.find((i) => i.id === r.item_id);
          return {
            ...r,
            nickname: state.profiles.find((p) => p.id === r.member_id)?.nickname ?? '(알 수 없음)',
            item_name: item?.name ?? '(삭제된 아이템)',
            item_icon: item?.icon ?? '📦',
          };
        });
    },
    async requestItem(itemId, quantity, note) {
      await tick();
      if (!isMember()) throw new Error('승인된 문파원만 신청할 수 있습니다');
      if (!(quantity >= 1)) throw new Error('수량을 확인해 주세요');
      const item = state.items.find((i) => i.id === itemId && i.active);
      if (!item) throw new Error('창고에 없는 아이템입니다');
      if (item.stock < quantity) throw new Error('창고 재고가 부족합니다');
      const id = me()!.id;
      const pending = state.requests
        .filter((r) => r.member_id === id && r.status === 'pending')
        .reduce((s, r) => s + r.total_cost, 0);
      if (balance(id) - pending < item.cost * quantity) throw new Error('기여 점수가 부족합니다');
      state.requests.push({
        id: uid(), member_id: id, item_id: itemId, quantity, total_cost: item.cost * quantity,
        status: 'pending', note, created_at: new Date().toISOString(), decided_at: null,
      });
      save();
    },
    async decideRequest(id, approve) {
      await tick();
      if (!isOfficer()) throw new Error('운영진만 처리할 수 있습니다');
      const r = state.requests.find((x) => x.id === id);
      if (!r || r.status !== 'pending') throw new Error('이미 처리된 신청입니다');
      if (approve) {
        const item = state.items.find((i) => i.id === r.item_id)!;
        if (item.stock < r.quantity) throw new Error('창고 재고가 부족합니다');
        if (balance(r.member_id) < r.total_cost) throw new Error('신청자의 기여 점수가 부족합니다');
        item.stock -= r.quantity;
        if (r.total_cost > 0) {
          state.ledger.push({
            id: uid(), member_id: r.member_id, delta: -r.total_cost, kind: 'warehouse',
            reason: `${item.name} x${r.quantity}`, activity_date: null, created_at: new Date().toISOString(),
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
      if (!r || r.member_id !== me()?.id || r.status !== 'pending') throw new Error('취소할 수 없는 신청입니다');
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
