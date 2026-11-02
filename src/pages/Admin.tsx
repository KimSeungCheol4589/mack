import { useEffect, useState } from 'react';
import { ActivityImport } from '../components/ActivityImport';
import { ITEM_IMAGES, ITEM_IMAGE_LABEL, ItemIcon } from '../components/ItemIcon';
import { MemberGate, RoleBadge } from '../components/Layout';
import { PowerImport } from '../components/PowerImport';
import { RosterSheet } from '../components/RosterSheet';
import { WeeklySettlement } from '../components/WeeklySettlement';
import { api, fmt, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useLoad } from '../lib/hooks';
import { parseRosterPaste } from '../lib/rosterParse';
import { ACTIVITIES, BONUSES, KIND_LABEL, RANKS, ROLE_LABEL, STATUS_LABEL, type Guild, type ItemDraft, type Rank, type Role, type RosterDraft, type RosterImportRow } from '../lib/types';

const TABS = ['신청 처리', '참여 기록', '주간 결산', '명단 관리', '창고 관리', '문파 정보'] as const;
type Tab = (typeof TABS)[number];

export function Admin() {
  const [tab, setTab] = useState<Tab>('신청 처리');
  return (
    <MemberGate officer>
      <div className="page">
        <div className="page-head">
          <h1>문파 관리</h1>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === '신청 처리' && <RequestsTab />}
        {tab === '참여 기록' && <ActivityTab />}
        {tab === '주간 결산' && <SettleTab />}
        {tab === '명단 관리' && <RosterTab />}
        {tab === '창고 관리' && <ItemsTab />}
        {tab === '문파 정보' && <GuildTab />}
      </div>
    </MemberGate>
  );
}

function SettleTab() {
  // 스크린샷으로 저장하면 결산 미리보기를 새로 불러옴
  const [saved, setSaved] = useState(0);
  return (
    <>
      <PowerImport onSaved={() => setSaved((n) => n + 1)} />
      <WeeklySettlement refreshKey={saved} />
    </>
  );
}

function RequestsTab() {
  const requests = useLoad(() => api.listRequests());
  const roster = useLoad(() => api.listRoster());
  const { busy, run } = useAction();
  const [showAll, setShowAll] = useState(false);
  const coinsOf = new Map((roster.data ?? []).map((m) => [m.id, m.coins]));
  const rows = (requests.data ?? []).filter((r) => showAll || r.status === 'pending');

  const decide = (id: string, approve: boolean) =>
    run(() => api.decideRequest(id, approve), approve ? '승인했습니다. 게임에서 아이템을 지급해 주세요' : '반려했습니다').then(() => {
      requests.reload();
      roster.reload();
    });

  return (
    <section className="panel">
      <div className="panel-title-row">
        <h2 className="panel-title">창고 신청</h2>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 처리 완료 포함
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>신청일</th>
              <th>신청자</th>
              <th>아이템</th>
              <th className="r">수량</th>
              <th className="r">엽전</th>
              <th className="r">신청자 보유</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{fmtDate(r.created_at)}</td>
                <td className="strong">{r.nickname}</td>
                <td>
                  <ItemIcon icon={r.item_icon} className="mini-icon" /> {r.item_name}
                  {r.note && <div className="muted small">{r.note}</div>}
                </td>
                <td className="r num">{r.quantity}</td>
                <td className="r num">{fmt(r.total_cost)}</td>
                <td className="r num muted">{fmt(coinsOf.get(r.roster_id) ?? 0)}</td>
                <td>
                  {r.status === 'pending' ? (
                    <div className="row">
                      <button className="btn btn-small btn-jade" disabled={busy} onClick={() => decide(r.id, true)}>
                        승인
                      </button>
                      <button className="btn btn-small" disabled={busy} onClick={() => decide(r.id, false)}>
                        반려
                      </button>
                    </div>
                  ) : (
                    <span className={`status status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  )}
                </td>
              </tr>
            ))}
            {requests.data && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted center">
                  처리할 신청이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivityTab() {
  const [version, setVersion] = useState(0);
  return (
    <>
      <ActivityImport onSaved={() => setVersion((v) => v + 1)} />
      <RosterSheet key={version} editable />
      <CoinAdjust />
    </>
  );
}

/** 운영진 엽전 조정 (+ 지급 / - 차감) 과 최근 엽전 기록 */
function CoinAdjust() {
  const roster = useLoad(() => api.listRoster());
  const coins = useLoad(() => api.listCoins());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const { busy, run } = useAction();
  const list = (roster.data ?? []).filter((m) => m.active);
  const nick = new Map((roster.data ?? []).map((m) => [m.id, m.nickname]));
  const delta = Number(amount);
  const valid = selected.size > 0 && Number.isInteger(delta) && delta !== 0 && memo.trim().length > 0;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="grid-2 wide-left">
      <section className="panel">
        <h2 className="panel-title">✏️ 엽전 조정</h2>
        <p className="muted small">기록 누락 보정이나 따로 주는 엽전에 씁니다. 주간 분배와 보너스는 주간 결산 탭에서 자동으로 지급됩니다.</p>
        <div className="row">
          <button className="link-btn" onClick={() => setSelected(new Set(list.map((m) => m.id)))}>
            전체 선택
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
          <span className="muted small">{selected.size}명 선택</span>
        </div>
        <div className="chips">
          {list.map((m) => (
            <button key={m.id} className={selected.has(m.id) ? 'chip on' : 'chip'} onClick={() => toggle(m.id)}>
              {m.nickname}
            </button>
          ))}
        </div>
        <div className="form-row">
          <label className="field">
            <span>엽전 (음수면 차감)</span>
            <input className="input" type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span>사유 (필수)</span>
            <input className="input" placeholder="예: 기록 누락 보정" maxLength={40} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        <button
          className="btn btn-red"
          disabled={busy || !valid}
          onClick={() =>
            run(() => api.adjustCoins([...selected], delta, memo.trim()), `${selected.size}명 ${delta > 0 ? '+' : ''}${fmt(delta)}전 기록했습니다`).then((ok) => {
              if (ok) {
                setSelected(new Set());
                setMemo('');
                setAmount('');
                coins.reload();
                roster.reload();
              }
            })
          }
        >
          {selected.size}명에게 {delta > 0 ? '+' : ''}
          {amount || 0}전 기록
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">최근 엽전 기록</h2>
        <ul className="log">
          {(coins.data ?? []).slice(0, 40).map((l) => (
            <li key={l.id}>
              <span className="muted small">{fmtDate(l.created_at)}</span>
              <span className={`kind kind-${l.kind}`}>{KIND_LABEL[l.kind]}</span>
              <span className="strong">{nick.get(l.roster_id) ?? '-'}</span>
              <span className="grow">{l.reason}</span>
              <span className={`num ${l.delta > 0 ? 'up' : 'down'}`}>
                {l.delta > 0 ? '+' : ''}
                {fmt(l.delta)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const EMPTY_ROSTER: RosterDraft = { nickname: '', rank: '문파원', combat_power: 0, active: true };

function RosterTab() {
  const { isMaster, me } = useAuth();
  const roster = useLoad(() => api.listRoster());
  const accounts = useLoad(() => api.listMembers());
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<RosterDraft | null>(null);
  const [paste, setPaste] = useState('');
  const parsed = paste.trim() ? parseRosterPaste(paste) : null;

  const reload = () => {
    roster.reload();
    accounts.reload();
  };
  const act = (fn: () => Promise<unknown>, ok: string) => run(fn, ok).then((done) => (reload(), done));
  const all = accounts.data ?? [];
  const pending = all.filter((m) => !m.approved);
  const approved = all.filter((m) => m.approved);
  const rosterOf = new Map((roster.data ?? []).filter((r) => r.profile_id).map((r) => [r.profile_id!, r]));
  const existing = new Set((roster.data ?? []).map((r) => r.nickname));
  const set = <K extends keyof RosterDraft>(k: K, v: RosterDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <>
      <div className="grid-2 wide-left">
        <section className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">문파원 명단 ({(roster.data ?? []).filter((r) => r.active).length}명)</h2>
            <button className="btn btn-small btn-red" onClick={() => setDraft({ ...EMPTY_ROSTER })}>
              + 문파원 추가
            </button>
          </div>
          <p className="muted small">홈페이지에 가입하지 않은 문파원도 명단에 넣습니다. 같은 닉네임으로 가입·승인되면 계정이 자동으로 연결됩니다.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>직위</th>
                  <th>닉네임</th>
                  <th className="r">전투력</th>
                  <th className="r">보유엽전</th>
                  <th>계정</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(roster.data ?? []).map((r) => (
                  <tr key={r.id} className={r.active ? undefined : 'dim'}>
                    <td>{r.rank}</td>
                    <td className="strong">
                      {r.nickname} {!r.active && <span className="muted small">(쉬는 중)</span>}
                    </td>
                    <td className="r num">{fmt(r.combat_power)}</td>
                    <td className="r num">{fmt(r.coins)}</td>
                    <td>
                      <select
                        className="input input-small"
                        value={r.profile_id ?? ''}
                        disabled={busy}
                        aria-label={`${r.nickname} 계정 연결`}
                        onChange={(e) => act(() => api.linkRoster(r.id, e.target.value || null), e.target.value ? '계정을 연결했습니다' : '연결을 풀었습니다')}
                      >
                        <option value="">연결 안 됨</option>
                        {approved
                          .filter((a) => a.id === r.profile_id || !rosterOf.has(a.id))
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.nickname}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="r">
                      <button className="link-btn" onClick={() => setDraft({ id: r.id, nickname: r.nickname, rank: r.rank, combat_power: r.combat_power, active: r.active })}>
                        수정
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          {draft ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => api.saveRoster(draft), '저장했습니다')) {
                  setDraft(null);
                  reload();
                }
              }}
            >
              <h2 className="panel-title">{draft.id ? '문파원 수정' : '문파원 추가'}</h2>
              <label className="field">
                <span>닉네임 (게임과 똑같이)</span>
                <input className="input" required maxLength={20} autoFocus value={draft.nickname} onChange={(e) => set('nickname', e.target.value)} />
              </label>
              <div className="form-row">
                <label className="field">
                  <span>직위</span>
                  <select className="input" value={draft.rank} onChange={(e) => set('rank', e.target.value as Rank)}>
                    {RANKS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>전투력</span>
                  <input className="input num" inputMode="numeric" value={draft.combat_power} onChange={(e) => set('combat_power', Number(e.target.value.replace(/\D/g, '')) || 0)} />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} /> 활동 중 (끄면 결산·표에서 빠짐, 기록은 남음)
              </label>
              <div className="row-end">
                {draft.id && (
                  <button
                    type="button"
                    className="btn danger-btn"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`${draft.nickname} 님을 명단에서 지울까요? 참여·엽전 기록도 모두 지워집니다. 잠시 쉬는 거라면 '활동 중'을 끄세요.`))
                        act(() => api.deleteRoster(draft.id!), '명단에서 지웠습니다').then(() => setDraft(null));
                    }}
                  >
                    삭제
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setDraft(null)}>
                  취소
                </button>
                <button className="btn btn-red" disabled={busy}>
                  저장
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2 className="panel-title">📋 엑셀에서 붙여 넣기</h2>
              <p className="muted small">
                엑셀 문파원 시트에서 머리글(직위·닉네임·전/현 전투력·…·누적엽전)부터 마지막 줄까지 복사해 붙여 넣으세요. 같은 닉네임은 직위·전투력을 갱신하고, 누적엽전이 있으면 보유 엽전을 그 값에 맞춥니다.
              </p>
              <textarea className="input mono" rows={8} placeholder={'직위\t닉네임\t전/전투력\t현/전투력\t…\t누적엽전\n문파원\t홍길동\t200000\t210000\t…\t500'} value={paste} onChange={(e) => setPaste(e.target.value)} />
              {parsed && <ImportPreview rows={parsed.rows} skipped={parsed.skipped} existing={existing} onDone={() => (setPaste(''), reload())} />}
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">가입 대기 {pending.length > 0 && <span className="badge">{pending.length}</span>}</h2>
        {pending.length === 0 && <p className="muted">대기 중인 가입 신청이 없습니다.</p>}
        <ul className="pending">
          {pending.map((m) => (
            <li key={m.id}>
              <span className="strong">{m.nickname}</span>
              <span className="muted small">
                {fmtDate(m.joined_at)} 신청 · {existing.has(m.nickname) ? '명단에 같은 닉네임 있음 → 승인하면 자동 연결' : '명단에 없는 닉네임'}
              </span>
              <button className="btn btn-small btn-jade" disabled={busy} onClick={() => act(() => api.adminUpdateMember(m.id, { approved: true }), `${m.nickname} 님을 승인했습니다`)}>
                승인
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">홈페이지 계정 ({approved.length}명)</h2>
        <p className="muted small">관리 권한(문주·부문주)은 문주만 바꿀 수 있습니다. 승인을 취소하면 명단 연결도 풀립니다.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>닉네임</th>
                <th>권한</th>
                <th>명단</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {approved.map((m) => (
                <tr key={m.id}>
                  <td className="strong">{m.nickname}</td>
                  <td>
                    {isMaster && m.id !== me?.id ? (
                      <select
                        className="input input-small"
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => act(() => api.adminUpdateMember(m.id, { role: e.target.value as Role }), '권한을 바꿨습니다')}
                      >
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </td>
                  <td>{rosterOf.get(m.id)?.nickname ?? <span className="muted">연결 안 됨</span>}</td>
                  <td className="r">
                    {m.id !== me?.id && m.role !== 'master' && (
                      <button
                        className="link-btn danger"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`${m.nickname} 계정의 승인을 취소할까요?`)) act(() => api.adminUpdateMember(m.id, { approved: false }), '승인을 취소했습니다');
                        }}
                      >
                        승인 취소
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ImportPreview({ rows, skipped, existing, onDone }: { rows: RosterImportRow[]; skipped: string[]; existing: Set<string>; onDone: () => void }) {
  const { busy, run } = useAction();
  const added = rows.filter((r) => !existing.has(r.nickname)).length;
  return (
    <div className="import-preview">
      <p className="week-note">
        {rows.length}명 읽음 · 새로 추가 {added}명 · 갱신 {rows.length - added}명
        {skipped.length > 0 && ` · 건너뛴 줄 ${skipped.length}개`}
      </p>
      <div className="table-wrap short-table">
        <table className="table">
          <thead>
            <tr>
              <th>직위</th>
              <th>닉네임</th>
              <th className="r">전투력</th>
              <th className="r">누적엽전</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.nickname}>
                <td>{r.rank}</td>
                <td className="strong">{r.nickname}</td>
                <td className="r num">{fmt(r.combat_power)}</td>
                <td className="r num">{r.coins === null ? <span className="muted">-</span> : fmt(r.coins)}</td>
                <td className="muted small">{existing.has(r.nickname) ? '갱신' : '추가'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <details className="muted small">
          <summary>건너뛴 줄</summary>
          <ul className="ocr-lines">
            {skipped.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="row-end">
        <button
          className="btn btn-red"
          disabled={busy || !rows.length}
          onClick={() =>
            run(async () => {
              const res = await api.importRoster(rows);
              onDone();
              return res;
            }, `${rows.length}명을 명단에 반영했습니다`)
          }
        >
          {rows.length}명 반영
        </button>
      </div>
    </div>
  );
}

const EMPTY_ITEM: ItemDraft = { name: '', category: '소모품', icon: '📦', description: '', stock: 0, cost: 0, active: true };

function ItemsTab() {
  const items = useLoad(() => api.listItems());
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const { busy, run } = useAction();
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="grid-2 wide-left">
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">창고 아이템</h2>
          <button className="btn btn-small btn-red" onClick={() => setDraft({ ...EMPTY_ITEM })}>
            + 아이템 추가
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>아이템</th>
                <th>분류</th>
                <th className="r">재고</th>
                <th className="r">가격</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((i) => (
                <tr key={i.id} className={i.active ? undefined : 'dim'}>
                  <td className="strong">
                    <ItemIcon icon={i.icon} className="mini-icon" /> {i.name} {!i.active && <span className="muted small">(숨김)</span>}
                  </td>
                  <td>{i.category}</td>
                  <td className={`r num ${i.stock === 0 ? 'down' : ''}`}>{fmt(i.stock)}</td>
                  <td className="r num">{fmt(i.cost)}전</td>
                  <td className="r">
                    <button className="link-btn" onClick={() => setDraft({ ...i })}>
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        {draft ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.saveItem({ ...draft, name: draft.name.trim() }), '저장했습니다')) {
                setDraft(null);
                items.reload();
              }
            }}
          >
            <h2 className="panel-title">{draft.id ? '아이템 수정' : '새 아이템'}</h2>
            <div className="form-row">
              <div className="field narrow-field">
                <span>아이콘</span>
                <ItemIcon icon={draft.icon} />
              </div>
              <label className="field">
                <span>이름</span>
                <input className="input" required maxLength={40} value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </label>
            </div>
            <div className="field">
              <span>아이콘 고르기</span>
              <div className="icon-picker">
                {Object.keys(ITEM_IMAGES).map((key) => (
                  <button
                    key={key}
                    type="button"
                    title={ITEM_IMAGE_LABEL[key] ?? key}
                    className={draft.icon === `img:${key}` ? 'icon-option on' : 'icon-option'}
                    onClick={() => set('icon', `img:${key}`)}
                  >
                    <ItemIcon icon={`img:${key}`} className="mini-icon" />
                  </button>
                ))}
                <input
                  className="input emoji-input"
                  placeholder="이모지"
                  maxLength={4}
                  value={draft.icon.startsWith('img:') ? '' : draft.icon}
                  onChange={(e) => set('icon', e.target.value)}
                />
              </div>
            </div>
            <label className="field">
              <span>분류</span>
              <input className="input" list="item-cats" required maxLength={12} value={draft.category} onChange={(e) => set('category', e.target.value)} />
              <datalist id="item-cats">
                {['강화', '소모품', '장비', '스킬', '기타'].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>설명</span>
              <input className="input" maxLength={80} value={draft.description} onChange={(e) => set('description', e.target.value)} />
            </label>
            <div className="form-row">
              <label className="field">
                <span>재고</span>
                <input className="input" type="number" min={0} value={draft.stock} onChange={(e) => set('stock', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              </label>
              <label className="field">
                <span>가격 (엽전)</span>
                <input className="input" type="number" min={0} value={draft.cost} onChange={(e) => set('cost', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} /> 문파원에게 보이기
            </label>
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                취소
              </button>
              <button className="btn btn-red" disabled={busy}>
                저장
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">아이템을 추가하거나 목록에서 수정할 아이템을 고르세요. 게임 창고에 아이템을 넣었으면 여기 재고도 같이 늘려 주세요.</p>
        )}
      </section>
    </div>
  );
}

function GuildTab() {
  const { isMaster } = useAuth();
  const guild = useLoad(() => api.getGuild());
  const [form, setForm] = useState<Guild | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (guild.data) setForm(guild.data);
  }, [guild.data]);
  if (!form) return <p className="muted">불러오는 중…</p>;
  const set = <K extends keyof Guild>(k: K, v: Guild[K]) => setForm({ ...form, [k]: v });
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  return (
    <form
      className="guild-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.updateGuild({ ...form, level: Math.max(1, form.level) }), '문파 정보를 저장했습니다. 새로고침하면 상단에도 반영됩니다');
      }}
    >
      <section className="panel">
        <h2 className="panel-title">문파 정보</h2>
        <div className="form-row">
          <label className="field">
            <span>문파 이름</span>
            <input className="input" required maxLength={20} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field">
            <span>문파 레벨</span>
            <input className="input" type="number" min={1} value={form.level} onChange={(e) => set('level', num(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>문파 한마디</span>
          <input className="input" maxLength={40} value={form.motto} onChange={(e) => set('motto', e.target.value)} />
        </label>
        <label className="field">
          <span>공지</span>
          <textarea className="input" rows={5} maxLength={1000} value={form.notice} onChange={(e) => set('notice', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.recruiting} onChange={(e) => set('recruiting', e.target.checked)} /> 문파원 모집 중
        </label>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">콘텐츠 참여 점수</h2>
          <p className="muted small">한 주 동안 받은 점수 비율로 그 주 문파 엽전을 나눕니다. 디코는 참여 횟수 × 점수입니다.</p>
          {ACTIVITIES.map((a) => (
            <label key={a.key} className="field">
              <span>
                {a.icon} {a.label} {a.multi && <span className="muted small">(1회당)</span>}
              </span>
              <input
                className="input"
                type="number"
                min={0}
                disabled={!isMaster}
                value={form.activity_points[a.key] ?? 0}
                onChange={(e) => set('activity_points', { ...form.activity_points, [a.key]: num(e.target.value) })}
              />
            </label>
          ))}
        </section>

        <section className="panel">
          <h2 className="panel-title">주간 결산 보너스 엽전</h2>
          <p className="muted small">주간 결산 때 지급됩니다. 동점이면 모두 받고, 0이면 지급하지 않습니다.</p>
          {BONUSES.map((b) => (
            <label key={b.key} className="field">
              <span>
                {b.icon} {b.label} <span className="muted small">— {b.desc}</span>
              </span>
              <input
                className="input"
                type="number"
                min={0}
                disabled={!isMaster}
                value={form.weekly_bonus?.[b.key] ?? 0}
                onChange={(e) => set('weekly_bonus', { ...form.weekly_bonus, [b.key]: num(e.target.value) })}
              />
            </label>
          ))}
          {!isMaster && <p className="muted small">점수·보너스 기준은 문주만 바꿀 수 있습니다.</p>}
        </section>
      </div>

      <div className="row-end">
        <button className="btn btn-red" disabled={busy}>
          저장
        </button>
      </div>
    </form>
  );
}
