export type Role = 'master' | 'officer' | 'member';
/** 명단 직위 (게임 문파 직위) */
export type Rank = '문파장' | '부문파장' | '문파원';
export type ActivityKey = 'yosin' | 'barrier' | 'singi' | 'garden' | 'clone' | 'discord';
export type BonusKey = 'top_power' | 'top_growth';
export type CoinKind = 'share' | BonusKey | 'warehouse' | 'adjust';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Guild {
  name: string;
  level: number;
  motto: string;
  notice: string;
  recruiting: boolean;
  /** 콘텐츠 1회 참여 점수 (디코는 횟수만큼) */
  activity_points: Record<ActivityKey, number>;
  /** 주간 결산 보너스 엽전: 최고 전투력, 최고 성장 */
  weekly_bonus: Record<BonusKey, number>;
  /** 게임의 문파 엽전 보유량 (운영진 입력) */
  coins: number;
  /** 문파 엽전을 마지막으로 입력한 때 (입력한 적 없으면 null) */
  coins_at: string | null;
}

/** 홈페이지 계정 (구글 로그인) */
export interface Member {
  id: string;
  nickname: string;
  role: Role;
  approved: boolean;
  joined_at: string;
  /** 본인이 게임 닉네임을 정했는지 (구글 가입 직후에는 false) */
  nickname_confirmed: boolean;
}

/** 문파원 명단 한 줄 (운영진 관리, 홈페이지 가입 여부와 무관) */
export interface RosterMember {
  id: string;
  nickname: string;
  rank: Rank;
  combat_power: number;
  active: boolean;
  /** 연결된 홈페이지 계정 */
  profile_id: string | null;
  /** 성장 비교 기준 (지난 결산 값, 없으면 첫 기록). 없으면 null */
  prev_power: number | null;
  /** 지난 결산 대비 전투력 변화 */
  growth: number;
  /** 보유 엽전 (문파원에게만 보임, 비로그인은 0) */
  coins: number;
  /** 누적 엽전 = 받은 엽전 합계 (창고 사용 제외) */
  earned: number;
}

export type RosterDraft = Pick<RosterMember, 'nickname' | 'rank' | 'combat_power' | 'active'> & { id?: string };

/** 명단 붙여넣기 한 줄: 엑셀 '직위 닉네임 … 현 전투력 … 누적엽전' */
export interface RosterImportRow {
  nickname: string;
  rank: Rank;
  combat_power: number;
  /** 누적엽전 (있으면 지금 잔액과의 차이만큼 조정으로 넣음) */
  coins: number | null;
}

/** 한 주의 콘텐츠 참여: roster_id → 콘텐츠 → 횟수 */
export type WeekActivities = Record<string, Partial<Record<ActivityKey, number>>>;

export interface CoinEntry {
  id: string;
  roster_id: string;
  delta: number;
  kind: CoinKind;
  /** 분배·보너스는 결산한 주의 수요일 */
  week: string | null;
  reason: string;
  created_at: string;
}

/** 결산 미리보기/결과 한 줄: 비교 기준 전투력(prev_power)이 없으면 성장 보너스 대상이 아님 */
export interface SettlementRow {
  roster_id: string;
  nickname: string;
  prev_power: number | null;
  power: number;
  points: number;
  /** 분배 엽전 (미리보기에서는 0) */
  share: number;
}

export interface Settlement {
  /** 결산한 주의 수요일 'YYYY-MM-DD' */
  week: string;
  pool: number;
  total_points: number;
  /** 결산할 때의 문파 엽전 보유량 (다음 결산 차액 계산용) */
  guild_coins: number | null;
  settled_at: string;
  rows: SettlementRow[];
}

export interface Item {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  stock: number;
  cost: number;
  active: boolean;
}

export type ItemDraft = Omit<Item, 'id'> & { id?: string };

export interface ItemRequest {
  id: string;
  roster_id: string;
  item_id: string;
  quantity: number;
  total_cost: number;
  status: RequestStatus;
  note: string;
  created_at: string;
  decided_at: string | null;
  // 화면 표시용 (백엔드에서 채움)
  nickname: string;
  item_name: string;
  item_icon: string;
}

export interface Session {
  userId: string;
  email: string;
}

export interface Deck {
  id: string;
  author_id: string;
  author_nickname: string | null;
  title: string;
  purpose: string;
  /** 8칸 순서대로 도술 이름, 빈 칸은 null */
  slots: (string | null)[];
  /** 궁극기 칸에 고른 스타일 (같은 스타일 3개 이상일 때) */
  ultimate_style: string | null;
  description: string;
  video_url: string;
  guild_pick: boolean;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
  updated_at: string;
}

export type DeckDraft = Pick<Deck, 'title' | 'purpose' | 'slots' | 'ultimate_style' | 'description' | 'video_url'> & { id?: string };

export interface GuestbookEntry {
  id: string;
  author_id: string | null;
  name: string;
  message: string;
  created_at: string;
}

export interface VisitStats {
  today: number;
  total: number;
}

export interface Backend {
  mode: 'demo' | 'supabase';

  getSession(): Promise<Session | null>;
  onAuthChange(cb: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, nickname: string): Promise<{ needsConfirm: boolean }>;
  /** 구글 계정으로 로그인(처음이면 가입). 구글 화면으로 이동했다가 돌아옵니다. */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;

  getGuild(): Promise<Guild>;
  updateGuild(patch: Partial<Guild>): Promise<void>;

  /** 홈페이지 계정 목록 (로그인 사용자) */
  listMembers(): Promise<Member[]>;
  getMember(id: string): Promise<Member | null>;
  /** 닉네임만 본인이 바꿈 */
  updateMyProfile(patch: { nickname: string }): Promise<void>;
  adminUpdateMember(id: string, patch: { role?: Role; approved?: boolean }): Promise<void>;

  /** 문파원 명단 (전투력 높은 순) */
  listRoster(): Promise<RosterMember[]>;
  saveRoster(draft: RosterDraft): Promise<void>;
  deleteRoster(id: string): Promise<void>;
  /** 명단과 홈페이지 계정 연결 (null 이면 해제) */
  linkRoster(rosterId: string, profileId: string | null): Promise<void>;
  /** 엑셀 붙여넣기: 닉네임이 같으면 갱신, 없으면 추가. 누적엽전은 차이만큼 조정 */
  importRoster(rows: RosterImportRow[]): Promise<{ added: number; updated: number }>;
  /** 스크린샷으로 읽은 전투력 일괄 저장 */
  setPowers(updates: { id: string; combat_power: number }[]): Promise<void>;

  /** 그 주(수요일)의 콘텐츠 참여 */
  listActivities(week: string): Promise<WeekActivities>;
  /** 횟수 0 이면 지움. 디코 외에는 0 또는 1 */
  setActivity(rosterId: string, kind: ActivityKey, week: string, count: number): Promise<void>;

  listCoins(rosterId?: string): Promise<CoinEntry[]>;
  /** 운영진 엽전 조정 (+/-) */
  adjustCoins(rosterIds: string[], delta: number, reason: string): Promise<void>;

  /** 최근 결산 목록 (최근 주가 먼저) */
  listSettlements(): Promise<Settlement[]>;
  /** 이 주를 지금 결산하면 들어갈 값 (share 는 0) */
  previewWeek(week: string): Promise<SettlementRow[]>;
  /** 그 주 문파 엽전을 점수 비율로 분배하고 최고 전투력·최고 성장 보너스 지급 */
  settleWeek(week: string, pool: number): Promise<void>;
  /** 가장 최근 결산 취소 (분배·보너스도 회수) */
  cancelSettlement(week: string): Promise<void>;

  listItems(): Promise<Item[]>;
  saveItem(item: ItemDraft): Promise<void>;

  listRequests(rosterId?: string): Promise<ItemRequest[]>;
  requestItem(itemId: string, quantity: number, note: string): Promise<void>;
  decideRequest(id: string, approve: boolean): Promise<void>;
  cancelRequest(id: string): Promise<void>;

  listDecks(): Promise<Deck[]>;
  getDeck(id: string): Promise<Deck | null>;
  /** 새 덱이면 만들고 id 를 돌려줌 */
  saveDeck(draft: DeckDraft): Promise<string>;
  deleteDeck(id: string): Promise<void>;
  setDeckLike(id: string, liked: boolean): Promise<void>;
  setGuildPick(id: string, pick: boolean): Promise<void>;

  listGuestbook(): Promise<GuestbookEntry[]>;
  addGuestbook(name: string, message: string): Promise<void>;
  deleteGuestbook(id: string): Promise<void>;

  recordVisit(visitorId: string): Promise<void>;
  getVisitStats(): Promise<VisitStats>;
}

export const ROLE_LABEL: Record<Role, string> = {
  master: '문주',
  officer: '부문주',
  member: '문파원',
};

export const RANKS: Rank[] = ['문파장', '부문파장', '문파원'];

export const ACTIVITIES: { key: ActivityKey; label: string; short: string; icon: string; multi?: boolean }[] = [
  { key: 'yosin', label: '요신 토벌령', short: '요신', icon: '⚔️' },
  { key: 'barrier', label: '결계지 방어', short: '결계지', icon: '🛡️' },
  { key: 'singi', label: '신기 쟁탈전', short: '신기', icon: '🏆' },
  { key: 'garden', label: '미혹의 정원', short: '미혹', icon: '🌸' },
  // 문파 콘텐츠에 분신으로만 참여한 횟수 (요신·결계지 둘 다면 2)
  { key: 'clone', label: '분신 참여', short: '분신', icon: '👥', multi: true },
  { key: 'discord', label: '디스코드 참여', short: '디코', icon: '🎧', multi: true },
];

export const KIND_LABEL: Record<CoinKind, string> = {
  share: '주간 분배',
  top_power: '최고 전투력',
  top_growth: '최고 성장',
  warehouse: '창고',
  adjust: '조정',
};

export const DEFAULT_ACTIVITY_POINTS: Record<ActivityKey, number> = {
  yosin: 1,
  barrier: 1,
  singi: 1,
  garden: 1,
  clone: 1,
  discord: 1,
};

export const DEFAULT_WEEKLY_BONUS: Record<BonusKey, number> = {
  top_power: 300,
  top_growth: 300,
};

export const BONUSES: { key: BonusKey; label: string; icon: string; desc: string }[] = [
  { key: 'top_power', label: '주간 최고 전투력', icon: '👑', desc: '결산 때 전투력이 가장 높은 문파원' },
  { key: 'top_growth', label: '주간 최고 성장', icon: '🔥', desc: '지난 결산보다 전투력이 가장 많이 오른 문파원' },
];

/** 참여 점수 = Σ 횟수 × 콘텐츠 점수 */
export function activityPoints(acts: Partial<Record<ActivityKey, number>> | undefined, points: Record<ActivityKey, number>): number {
  return ACTIVITIES.reduce((s, a) => s + (acts?.[a.key] ?? 0) * (points[a.key] ?? 0), 0);
}

/** 점수 비율 분배, 1전 미만 버림 (supabase/schema.sql 의 settle_week 와 같은 규칙) */
export function withShares<T extends { points: number }>(rows: T[], pool: number): (T & { share: number })[] {
  const total = rows.reduce((s, r) => s + r.points, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? Math.floor((pool * r.points) / total) : 0 }));
}

/** 결산 수상자 (settle_week 와 같은 규칙: 동점이면 모두) */
export function weekWinners(rows: { roster_id: string; prev_power: number | null; power: number }[]) {
  const topPower = rows.reduce((m, r) => Math.max(m, r.power), 0);
  const growths = rows.filter((r) => r.prev_power !== null).map((r) => r.power - r.prev_power!);
  const topGrowth = growths.length ? Math.max(...growths) : 0;
  return {
    topPower,
    topGrowth,
    powerIds: new Set(rows.filter((r) => topPower > 0 && r.power === topPower).map((r) => r.roster_id)),
    growthIds: new Set(rows.filter((r) => topGrowth > 0 && r.prev_power !== null && r.power - r.prev_power === topGrowth).map((r) => r.roster_id)),
  };
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
};
