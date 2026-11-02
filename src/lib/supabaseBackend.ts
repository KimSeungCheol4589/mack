import { createClient, type Session as SbSession } from '@supabase/supabase-js';
import type { Backend, Deck, GuestbookEntry, Item, ItemRequest, LedgerEntry, Member, PowerWeekRow, Session } from './types';

const ERROR_HINTS: [RegExp, string][] = [
  [/Invalid login credentials/i, '이메일 또는 비밀번호가 맞지 않습니다'],
  [/Email not confirmed/i, '이메일 인증을 먼저 완료해 주세요'],
  [/User already registered/i, '이미 가입된 이메일입니다'],
  [/Database error saving new user/i, '이미 사용 중인 닉네임일 수 있습니다'],
  [/Password should be at least/i, '비밀번호는 6자 이상이어야 합니다'],
  [/profiles_nickname_key/i, '이미 사용 중인 닉네임입니다'],
  [/point_ledger_weekly_once/i, '이번 주에 이미 기록된 문파원이 있습니다. 새로고침 후 다시 확인해 주세요'],
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
      const { data, error } = await sb
        .from('member_overview')
        .select('*')
        .order('combat_power', { ascending: false });
      fail(error);
      return (data ?? []) as Member[];
    },
    async getMember(id) {
      const { data, error } = await sb.from('member_overview').select('*').eq('id', id).maybeSingle();
      fail(error);
      return data as Member | null;
    },
    async updateMyProfile(patch) {
      // 본인이 닉네임을 정하면 '게임 닉네임 확정'으로 표시
      const { error } = await sb.from('profiles').update({ nickname: patch.nickname, nickname_confirmed: true }).eq('id', await uid());
      fail(error);
    },
    async adminUpdateMember(id, patch) {
      const { error } = await sb.from('profiles').update(patch).eq('id', id);
      fail(error);
    },

    async listLedger(memberId) {
      let q = sb.from('point_ledger').select('*').order('created_at', { ascending: false }).limit(300);
      if (memberId) q = q.eq('member_id', memberId);
      const { data, error } = await q;
      fail(error);
      return (data ?? []).map((r) => ({ ...r, id: String(r.id) })) as LedgerEntry[];
    },
    async grantPoints(memberIds, delta, kind, reason, activityDate) {
      const rows = memberIds.map((member_id) => ({ member_id, delta, kind, reason, activity_date: activityDate ?? null }));
      const { error } = await sb.from('point_ledger').insert(rows);
      fail(error);
    },

    async listPowerWeeks() {
      const weeks = await sb.from('power_settlements').select('week, settled_at').order('week', { ascending: false }).limit(12);
      fail(weeks.error);
      const list = weeks.data ?? [];
      if (!list.length) return [];
      const [rows, members] = await Promise.all([
        sb.from('power_settlement_rows').select('*').in('week', list.map((w) => w.week)),
        sb.from('profiles').select('id, nickname'),
      ]);
      fail(rows.error);
      fail(members.error);
      const nickById = new Map((members.data ?? []).map((m) => [m.id, m.nickname as string]));
      return list.map((w) => ({
        week: w.week as string,
        settled_at: w.settled_at as string,
        rows: (rows.data ?? [])
          .filter((r) => r.week === w.week)
          .map((r) => ({ member_id: r.member_id, nickname: nickById.get(r.member_id) ?? '(탈퇴)', prev_power: r.prev_power, power: r.power }))
          .sort((a, b) => b.power - a.power),
      }));
    },
    async previewPowerWeek(week) {
      const [rows, members] = await Promise.all([
        sb.rpc('power_week_preview', { p_week: week }),
        sb.from('profiles').select('id, nickname'),
      ]);
      fail(rows.error);
      fail(members.error);
      const nickById = new Map((members.data ?? []).map((m) => [m.id, m.nickname as string]));
      return ((rows.data ?? []) as Omit<PowerWeekRow, 'nickname'>[])
        .map((r) => ({ ...r, nickname: nickById.get(r.member_id) ?? '-' }))
        .sort((a, b) => b.power - a.power);
    },
    async settlePowerWeek(week) {
      const { error } = await sb.rpc('settle_power_week', { p_week: week });
      fail(error);
    },
    async cancelPowerWeek(week) {
      const { error } = await sb.rpc('cancel_power_week', { p_week: week });
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

    async listRequests(memberId) {
      let q = sb.from('warehouse_requests').select('*').order('created_at', { ascending: false }).limit(300);
      if (memberId) q = q.eq('member_id', memberId);
      const [reqs, items, members] = await Promise.all([
        q,
        sb.from('warehouse_items').select('id, name, icon'),
        sb.from('profiles').select('id, nickname'),
      ]);
      fail(reqs.error);
      fail(items.error);
      fail(members.error);
      const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
      const nickById = new Map((members.data ?? []).map((m) => [m.id, m.nickname as string]));
      return (reqs.data ?? []).map((r) => ({
        ...r,
        nickname: nickById.get(r.member_id) ?? '(알 수 없음)',
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
