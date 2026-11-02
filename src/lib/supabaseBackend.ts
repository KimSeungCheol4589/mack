import { createClient, type Session as SbSession } from '@supabase/supabase-js';
import type {
  ActivityKey, Backend, CoinEntry, Deck, GuestbookEntry, Item, ItemRequest, Member, RosterMember, Session, SettlementRow, WeekActivities,
} from './types';

const PROFILE_COLS = 'id, nickname, role, approved, joined_at, nickname_confirmed';

const ERROR_HINTS: [RegExp, string][] = [
  [/Invalid login credentials/i, '이메일 또는 비밀번호가 맞지 않습니다'],
  [/Email not confirmed/i, '이메일 인증을 먼저 완료해 주세요'],
  [/User already registered/i, '이미 가입된 이메일입니다'],
  [/Database error saving new user/i, '이미 사용 중인 닉네임일 수 있습니다'],
  [/Password should be at least/i, '비밀번호는 6자 이상이어야 합니다'],
  [/profiles_nickname_key/i, '이미 사용 중인 닉네임입니다'],
  [/roster_nickname_key/i, '이미 명단에 있는 닉네임입니다'],
  [/roster_profile_id_key/i, '이 계정은 이미 다른 명단과 연결되어 있습니다'],
  [/coin_ledger_weekly_once/i, '이미 결산된 주입니다. 새로고침 후 다시 확인해 주세요'],
];

function fail(error: { message: string } | null): void {
  if (!error) return;
  const hint = ERROR_HINTS.find(([re]) => re.test(error.message));
  throw new Error(hint ? hint[1] : error.message);
}

function toSession(s: SbSession | null): Session | null {
  return s ? { userId: s.user.id, email: s.user.email ?? '' } : null;
}

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  // PKCE: 구글 로그인 후 '?code=...' 로 돌아옴. (기본 방식은 '#access_token=...' 이라 HashRouter 주소와 겹침)
  const sb = createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } });

  async function uid(): Promise<string> {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('로그인이 필요합니다');
    return data.session.user.id;
  }

  async function rosterNames(): Promise<Map<string, string>> {
    const { data, error } = await sb.from('roster').select('id, nickname');
    fail(error);
    return new Map((data ?? []).map((m) => [m.id as string, m.nickname as string]));
  }

  return {
    mode: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, s) => cb(toSession(s)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signUp(email, password, nickname) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { nickname }, emailRedirectTo: window.location.origin + window.location.pathname },
      });
      fail(error);
      return { needsConfirm: !data.session };
    },
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        // 홈페이지 주소(경로까지, # 앞)로 돌아옴. Supabase 의 Site URL / Redirect URLs 에 들어 있어야 함
        options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: 'select_account' } },
      });
      fail(error);
    },
    async signOut() {
      const { error } = await sb.auth.signOut();
      fail(error);
    },

    async getGuild() {
      const { data, error } = await sb.from('guild').select('*').eq('id', 1).single();
      fail(error);
      return data;
    },
    async updateGuild(patch) {
      const { error } = await sb.from('guild').update(patch).eq('id', 1);
      fail(error);
    },

    async listMembers() {
      const { data, error } = await sb.from('profiles').select(PROFILE_COLS).order('joined_at');
      fail(error);
      return (data ?? []) as Member[];
    },
    async getMember(id) {
      const { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
      fail(error);
      return data as Member | null;
    },
    async updateMyProfile(patch) {
      // 본인이 닉네임을 정하면 '게임 닉네임 확정'으로 표시 (같은 닉네임의 명단과 자동 연결)
      const { error } = await sb.from('profiles').update({ nickname: patch.nickname.trim(), nickname_confirmed: true }).eq('id', await uid());
      fail(error);
    },
    async adminUpdateMember(id, patch) {
      const { error } = await sb.from('profiles').update(patch).eq('id', id);
      fail(error);
    },

    async listRoster() {
      const { data, error } = await sb.from('roster_overview').select('*').order('combat_power', { ascending: false });
      fail(error);
      return (data ?? []) as RosterMember[];
    },
    async saveRoster({ id, ...fields }) {
      const row = { ...fields, nickname: fields.nickname.trim() };
      const { error } = id ? await sb.from('roster').update(row).eq('id', id) : await sb.from('roster').insert(row);
      fail(error);
    },
    async deleteRoster(id) {
      const { error } = await sb.from('roster').delete().eq('id', id);
      fail(error);
    },
    async linkRoster(rosterId, profileId) {
      const { error } = await sb.from('roster').update({ profile_id: profileId }).eq('id', rosterId);
      fail(error);
    },
    async importRoster(rows) {
      const before = await sb.from('roster_overview').select('id, nickname, coins');
      fail(before.error);
      const existing = new Map((before.data ?? []).map((r) => [r.nickname as string, r]));
      const { data, error } = await sb
        .from('roster')
        .upsert(rows.map((r) => ({ nickname: r.nickname.trim(), rank: r.rank, combat_power: r.combat_power })), { onConflict: 'nickname' })
        .select('id, nickname');
      fail(error);
      const idByNick = new Map((data ?? []).map((r) => [r.nickname as string, r.id as string]));
      const adjust = rows
        .filter((r) => r.coins !== null)
        .map((r) => ({
          roster_id: idByNick.get(r.nickname.trim())!,
          delta: r.coins! - Number(existing.get(r.nickname.trim())?.coins ?? 0),
          kind: 'adjust',
          reason: '명단 가져오기 (누적엽전 맞춤)',
        }))
        .filter((r) => r.roster_id && r.delta !== 0);
      if (adjust.length) fail((await sb.from('coin_ledger').insert(adjust)).error);
      const added = rows.filter((r) => !existing.has(r.nickname.trim())).length;
      return { added, updated: rows.length - added };
    },
    async setPowers(updates) {
      const results = await Promise.all(updates.map((u) => sb.from('roster').update({ combat_power: u.combat_power }).eq('id', u.id)));
      results.forEach((r) => fail(r.error));
    },

    async listActivities(week) {
      const { data, error } = await sb.from('activities').select('roster_id, kind, count').eq('week', week);
      fail(error);
      const out: WeekActivities = {};
      for (const a of data ?? []) (out[a.roster_id] ??= {})[a.kind as ActivityKey] = a.count;
      return out;
    },
    async setActivity(rosterId, kind, week, count) {
      const { error } =
        count > 0
          ? await sb.from('activities').upsert({ roster_id: rosterId, kind, week, count }, { onConflict: 'roster_id,kind,week' })
          : await sb.from('activities').delete().eq('roster_id', rosterId).eq('kind', kind).eq('week', week);
      fail(error);
    },

    async listCoins(rosterId) {
      let q = sb.from('coin_ledger').select('*').order('created_at', { ascending: false }).limit(500);
      if (rosterId) q = q.eq('roster_id', rosterId);
      const { data, error } = await q;
      fail(error);
      return (data ?? []).map((r) => ({ ...r, id: String(r.id) })) as CoinEntry[];
    },
    async adjustCoins(rosterIds, delta, reason) {
      const { error } = await sb.from('coin_ledger').insert(rosterIds.map((roster_id) => ({ roster_id, delta, kind: 'adjust', reason })));
      fail(error);
    },

    async listSettlements() {
      const weeks = await sb.from('settlements').select('*').order('week', { ascending: false }).limit(12);
      fail(weeks.error);
      const list = weeks.data ?? [];
      if (!list.length) return [];
      const [rows, nicks] = await Promise.all([
        sb.from('settlement_rows').select('*').in('week', list.map((w) => w.week)),
        rosterNames(),
      ]);
      fail(rows.error);
      return list.map((w) => ({
        week: w.week as string,
        pool: w.pool as number,
        total_points: w.total_points as number,
        settled_at: w.settled_at as string,
        rows: (rows.data ?? [])
          .filter((r) => r.week === w.week)
          .map((r) => ({
            roster_id: r.roster_id, nickname: nicks.get(r.roster_id) ?? '(삭제됨)',
            prev_power: r.prev_power, power: r.power, points: r.points, share: r.share,
          }))
          .sort((a, b) => b.points - a.points || b.power - a.power),
      }));
    },
    async previewWeek(week) {
      const [rows, nicks] = await Promise.all([sb.rpc('week_preview', { p_week: week }), rosterNames()]);
      fail(rows.error);
      return ((rows.data ?? []) as Omit<SettlementRow, 'nickname' | 'share'>[])
        .map((r) => ({ ...r, nickname: nicks.get(r.roster_id) ?? '-', share: 0 }))
        .sort((a, b) => b.points - a.points || b.power - a.power);
    },
    async settleWeek(week, pool) {
      const { error } = await sb.rpc('settle_week', { p_week: week, p_pool: pool });
      fail(error);
    },
    async cancelSettlement(week) {
      const { error } = await sb.rpc('cancel_settlement', { p_week: week });
      fail(error);
    },

    async listItems() {
      const { data, error } = await sb
        .from('warehouse_items')
        .select('*')
        .order('category')
        .order('name');
      fail(error);
      return (data ?? []) as Item[];
    },
    async saveItem({ id, ...fields }) {
      const { error } = id
        ? await sb.from('warehouse_items').update(fields).eq('id', id)
        : await sb.from('warehouse_items').insert(fields);
      fail(error);
    },

    async listRequests(rosterId) {
      let q = sb.from('warehouse_requests').select('*').order('created_at', { ascending: false }).limit(300);
      if (rosterId) q = q.eq('roster_id', rosterId);
      const [reqs, items, nickById] = await Promise.all([q, sb.from('warehouse_items').select('id, name, icon'), rosterNames()]);
      fail(reqs.error);
      fail(items.error);
      const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
      return (reqs.data ?? []).map((r) => ({
        ...r,
        nickname: nickById.get(r.roster_id) ?? '(알 수 없음)',
        item_name: itemById.get(r.item_id)?.name ?? '(삭제된 아이템)',
        item_icon: itemById.get(r.item_id)?.icon ?? '📦',
      })) as ItemRequest[];
    },
    async requestItem(itemId, quantity, note) {
      const { error } = await sb.rpc('request_item', { p_item: itemId, p_qty: quantity, p_note: note });
      fail(error);
    },
    async decideRequest(id, approve) {
      const { error } = await sb.rpc('decide_request', { p_id: id, p_approve: approve });
      fail(error);
    },
    async cancelRequest(id) {
      const { error } = await sb.rpc('cancel_request', { p_id: id });
      fail(error);
    },

    async listDecks() {
      const { data, error } = await sb.from('deck_overview').select('*').order('created_at', { ascending: false }).limit(300);
      fail(error);
      return (data ?? []) as Deck[];
    },
    async getDeck(id) {
      const { data, error } = await sb.from('deck_overview').select('*').eq('id', id).maybeSingle();
      fail(error);
      return data as Deck | null;
    },
    async saveDeck({ id, ...fields }) {
      if (id) {
        const { error } = await sb.from('decks').update(fields).eq('id', id);
        fail(error);
        return id;
      }
      const { data, error } = await sb.from('decks').insert(fields).select('id').single();
      fail(error);
      return data!.id as string;
    },
    async deleteDeck(id) {
      const { error } = await sb.from('decks').delete().eq('id', id);
      fail(error);
    },
    async setDeckLike(id, liked) {
      const { error } = liked
        ? await sb.from('deck_likes').upsert({ deck_id: id }, { onConflict: 'deck_id,member_id', ignoreDuplicates: true })
        : await sb.from('deck_likes').delete().eq('deck_id', id).eq('member_id', await uid());
      fail(error);
    },
    async setGuildPick(id, pick) {
      const { error } = await sb.from('decks').update({ guild_pick: pick }).eq('id', id);
      fail(error);
    },

    async listGuestbook() {
      const { data, error } = await sb.from('guestbook').select('*').order('created_at', { ascending: false }).limit(200);
      fail(error);
      return (data ?? []) as GuestbookEntry[];
    },
    async addGuestbook(name, message) {
      const { error } = await sb.from('guestbook').insert({ name: name.trim(), message: message.trim() });
      fail(error);
    },
    async deleteGuestbook(id) {
      const { error } = await sb.from('guestbook').delete().eq('id', id);
      fail(error);
    },

    async recordVisit(visitorId) {
      await sb.rpc('record_visit', { p_visitor: visitorId });
    },
    async getVisitStats() {
      const { data, error } = await sb.rpc('visit_stats');
      fail(error);
      const row = (Array.isArray(data) ? data[0] : data) ?? { today: 0, total: 0 };
      return { today: Number(row.today), total: Number(row.total) };
    },
  };
}
