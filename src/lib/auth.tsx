import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Member, RosterMember, Session } from './types';

interface AuthState {
  ready: boolean;
  session: Session | null;
  me: Member | null;
  /** 내 계정과 연결된 명단 (보유 엽전 등) */
  myRoster: RosterMember | null;
  isMember: boolean;
  isOfficer: boolean;
  isMaster: boolean;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Member | null>(null);
  const [myRoster, setMyRoster] = useState<RosterMember | null>(null);

  const loadMe = useCallback(async (s: Session | null) => {
    setSession(s);
    const m = s ? await api.getMember(s.userId).catch(() => null) : null;
    setMe(m);
    setMyRoster(m?.approved ? ((await api.listRoster().catch(() => [])).find((r) => r.profile_id === m.id && r.active) ?? null) : null);
    setReady(true);
    // 구글 로그인에서 돌아온 '?code=...' 를 주소창에서 지움 (# 뒤 화면 주소는 그대로)
    if (s && new URLSearchParams(window.location.search).has('code')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, []);

  useEffect(() => {
    api.getSession().then(loadMe);
    return api.onAuthChange((s) => {
      // Supabase 콜백 안에서 바로 쿼리하면 교착될 수 있어 한 박자 미룹니다.
      setTimeout(() => loadMe(s), 0);
    });
  }, [loadMe]);

  const isMember = !!me?.approved;
  const value: AuthState = {
    ready,
    session,
    me,
    myRoster,
    isMember,
    isOfficer: isMember && (me!.role === 'master' || me!.role === 'officer'),
    isMaster: isMember && me!.role === 'master',
    refreshMe: () => loadMe(session),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider 밖에서 useAuth 를 쓸 수 없습니다');
  return ctx;
}
