import { useEffect, useState } from 'react';
import { ITEM_IMAGES, ITEM_IMAGE_LABEL, ItemIcon } from '../components/ItemIcon';
import { MemberGate, RoleBadge } from '../components/Layout';
import { PowerImport } from '../components/PowerImport';
import { WeeklySettlement } from '../components/WeeklySettlement';
import { api, fmt, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useLoad } from '../lib/hooks';
import { today, weekLabel, weekStart } from '../lib/week';
import { ACTIVITIES, BONUSES, KIND_LABEL, ROLE_LABEL, STATUS_LABEL, type ActivityKey, type Guild, type ItemDraft, type PowerTier, type Role } from '../lib/types';

const TABS = ['신청 처리', '참여 기록', '문파원 관리', '전투력·주간 결산', '창고 관리', '문파 정보'] as const;
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
        {tab === '문파원 관리' && <MembersTab />}
        {tab === '전투력·주간 결산' && <PowerTab />}
        {tab === '창고 관리' && <ItemsTab />}
        {tab === '문파 정보' && <GuildTab />}
      </div>
    </MemberGate>
  );
}

function PowerTab() {
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
  const members = useLoad(() => api.listMembers());
  const { busy, run } = useAction();
  const [showAll, setShowAll] = useState(false);
  const pointsOf = new Map((members.data ?? []).map((m) => [m.id, m.points]));
  const rows = (requests.data ?? []).filter((r) => showAll || r.status === 'pending');

  const decide = (id: string, approve: boolean) =>
    run(() => api.decideRequest(id, approve), approve ? '승인했습니다. 게임에서 아이템을 지급해 주세요' : '반려했습니다').then(() => {
      requests.reload();
      members.reload();
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
              <th className="r">점수</th>
              <th className="r">신청자 잔액</th>
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
                <td className="r num muted">{fmt(pointsOf.get(r.member_id) ?? 0)}</td>
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
  const members = useLoad(() => api.listMembers());
  const ledger = useLoad(() => api.listLedger());
  const guild = useLoad(() => api.getGuild());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ActivityKey | 'adjust'>('yosin');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const { busy, run } = useAction();

  // 활동을 바꾸면 그 활동의 기본 점수로 채움
  useEffect(() => {
    if (kind === 'adjust') setAmount('');
    else if (guild.data) setAmount(String(guild.data.activity_points[kind] ?? 0));
  }, [kind, guild.data]);

  const list = (members.data ?? []).filter((m) => m.approved);
  const nick = new Map(list.map((m) => [m.id, m.nickname]));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // 각 활동은 주 1회: 고른 날짜가 속한 주(수~화)에 이미 기록된 문파원은 선택할 수 없음
  const week = weekStart(date);
  const doneIds = new Set(
    kind === 'adjust'
      ? []
      : (ledger.data ?? [])
          .filter((l) => l.kind === kind && l.activity_date && weekStart(l.activity_date) === week)
          .map((l) => l.member_id),
  );
  const doneKey = [...doneIds].sort().join();
  useEffect(() => {
    setSelected((sel) => new Set([...sel].filter((id) => !doneIds.has(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey]);

  const delta = Number(amount);
  const [, mm, dd] = date.split('-');
  const reason =
    kind === 'adjust'
      ? memo.trim()
      : `${KIND_LABEL[kind]} ${Number(mm)}/${Number(dd)}${memo.trim() ? ` · ${memo.trim()}` : ''}`;
  const valid = selected.size > 0 && Number.isInteger(delta) && delta !== 0 && reason.length > 0;

  return (
    <div className="grid-2 wide-left">
      <section className="panel">
        <h2 className="panel-title">활동 참여 기록</h2>
        <p className="muted small">각 콘텐츠는 일주일(수요일 시작)에 한 번입니다. 콘텐츠가 끝나면 참여한 문파원을 골라 한 번에 기록하세요.</p>
        <div className="tabs activity-tabs">
          {ACTIVITIES.map((a) => (
            <button key={a.key} type="button" className={kind === a.key ? 'tab active' : 'tab'} onClick={() => setKind(a.key)}>
              {a.icon} {a.label}
            </button>
          ))}
          <button type="button" className={kind === 'adjust' ? 'tab active' : 'tab'} onClick={() => setKind('adjust')}>
            ✏️ 점수 조정
          </button>
        </div>
        <div className="row">
          <button className="link-btn" onClick={() => setSelected(new Set(list.filter((m) => !doneIds.has(m.id)).map((m) => m.id)))}>
            전체 선택
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
          <span className="muted small">{selected.size}명 선택</span>
        </div>
        {kind !== 'adjust' && (
          <p className="week-note">
            {weekLabel(week)} · 기록 완료 <strong>{doneIds.size}명</strong> / 남은 {list.length - doneIds.size}명
          </p>
        )}
        <div className="chips">
          {list.map((m) => {
            const done = doneIds.has(m.id);
            return (
              <button
                key={m.id}
                className={done ? 'chip done' : selected.has(m.id) ? 'chip on' : 'chip'}
                disabled={done}
                title={done ? '이번 주에 이미 기록됨' : undefined}
                onClick={() => toggle(m.id)}
              >
                {done ? '✓ ' : ''}
                {m.nickname}
              </button>
            );
          })}
        </div>
        <div className="form-row">
          {kind !== 'adjust' && (
            <label className="field">
              <span>참여 날짜</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>{kind === 'adjust' ? '점수 (음수면 차감)' : '1인당 점수'}</span>
            <input className="input" type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{kind === 'adjust' ? '사유 (필수)' : '메모 (선택)'}</span>
          <input
            className="input"
            placeholder={kind === 'adjust' ? '예: 기록 누락 보정' : '예: MVP, 늦참'}
            maxLength={40}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
        {reason && <p className="muted small">기록 내용: {reason}</p>}
        <button
          className="btn btn-red"
          disabled={busy || !valid}
          onClick={() =>
            run(() => api.grantPoints([...selected], delta, kind, reason, kind === 'adjust' ? undefined : date), `${selected.size}명 기록했습니다 (${delta > 0 ? '+' : ''}${delta}점)`).then((ok) => {
              if (ok) {
                setSelected(new Set());
                setMemo('');
                ledger.reload();
                members.reload();
              }
            })
          }
        >
          {selected.size}명에게 {Number.isFinite(delta) && delta > 0 ? '+' : ''}
          {amount || 0}점 기록
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">최근 기록</h2>
        <ul className="log">
          {(ledger.data ?? []).slice(0, 40).map((l) => (
            <li key={l.id}>
              <span className="muted small">{fmtDate(l.created_at)}</span>
              <span className={`kind kind-${l.kind}`}>{KIND_LABEL[l.kind]}</span>
              <span className="strong">{nick.get(l.member_id) ?? '-'}</span>
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

function MembersTab() {
  const { isMaster, me } = useAuth();
  const members = useLoad(() => api.listMembers());
  const { busy, run } = useAction();
  const [powerEdit, setPowerEdit] = useState<Record<string, string>>({});

  const all = members.data ?? [];
  const pending = all.filter((m) => !m.approved);
  const active = all.filter((m) => m.approved);
  const act = (fn: () => Promise<unknown>, ok: string) => run(fn, ok).then(members.reload);

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">가입 대기 {pending.length > 0 && <span className="badge">{pending.length}</span>}</h2>
        {pending.length === 0 && <p className="muted">대기 중인 가입 신청이 없습니다.</p>}
        <ul className="pending">
          {pending.map((m) => (
            <li key={m.id}>
              <span className="strong">{m.nickname}</span>
              <span className="muted small">전투력 {fmt(m.combat_power)} · {fmtDate(m.joined_at)} 신청</span>
              <button className="btn btn-small btn-jade" disabled={busy} onClick={() => act(() => api.adminUpdateMember(m.id, { approved: true }), `${m.nickname} 님을 승인했습니다`)}>
                승인
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">문파원 ({active.length}명)</h2>
        <p className="muted small">직책 변경은 문주만 할 수 있습니다. 탈퇴 처리하면 가입 대기 상태로 돌아갑니다.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>닉네임</th>
                <th>직책</th>
                <th className="r">전투력</th>
                <th className="r">점수</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((m) => {
                const editing = powerEdit[m.id];
                return (
                  <tr key={m.id}>
                    <td className="strong">{m.nickname}</td>
                    <td>
                      {isMaster && m.id !== me?.id ? (
                        <select
                          className="input input-small"
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => act(() => api.adminUpdateMember(m.id, { role: e.target.value as Role }), '직책을 바꿨습니다')}
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
                    <td className="r">
                      {editing !== undefined ? (
                        <form
                          className="row-end"
                          onSubmit={(e) => {
                            e.preventDefault();
                            act(() => api.adminUpdateMember(m.id, { combat_power: Math.max(0, Math.floor(Number(editing) || 0)) }), '전투력을 갱신했습니다').then(() =>
                              setPowerEdit(({ [m.id]: _, ...rest }) => rest),
                            );
                          }}
                        >
                          <input className="input input-small" inputMode="numeric" autoFocus value={editing} onChange={(e) => setPowerEdit((p) => ({ ...p, [m.id]: e.target.value.replace(/\D/g, '') }))} />
                          <button className="btn btn-small">저장</button>
                        </form>
                      ) : (
                        <button className="link-btn num" onClick={() => setPowerEdit((p) => ({ ...p, [m.id]: String(m.combat_power) }))}>
                          {fmt(m.combat_power)} ✎
                        </button>
                      )}
                    </td>
                    <td className="r num">{fmt(m.points)}</td>
                    <td className="r">
                      {m.id !== me?.id && m.role !== 'master' && (
                        <button
                          className="link-btn danger"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`${m.nickname} 님을 탈퇴 처리할까요?`)) act(() => api.adminUpdateMember(m.id, { approved: false }), '탈퇴 처리했습니다');
                          }}
                        >
                          탈퇴 처리
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
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
                  <td className="r num">{fmt(i.cost)}점</td>
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
                <span>가격 (기여 점수)</span>
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
  const setTier = (i: number, patch: Partial<PowerTier>) =>
    set('power_tiers', form.power_tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <form
      className="guild-form"
      onSubmit={(e) => {
        e.preventDefault();
        const tiers = [...form.power_tiers].sort((a, b) => b.min - a.min);
        run(() => api.updateGuild({ ...form, level: Math.max(1, form.level), power_tiers: tiers }), '문파 정보를 저장했습니다. 새로고침하면 상단에도 반영됩니다');
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
          <h2 className="panel-title">전투력 점수 구간</h2>
          <p className="muted small">전투력이 기준 이상인 구간 중 가장 높은 구간의 점수를 받습니다. 바꾸면 모든 문파원의 기여 점수에 바로 반영됩니다.</p>
          <table className="table">
            <thead>
              <tr>
                <th>전투력 기준 (이상)</th>
                <th>점수</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.power_tiers.map((t, i) => (
                <tr key={i}>
                  <td>
                    <input className="input input-small" type="number" min={0} disabled={!isMaster} value={t.min} onChange={(e) => setTier(i, { min: num(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input input-small" type="number" min={0} disabled={!isMaster} value={t.points} onChange={(e) => setTier(i, { points: num(e.target.value) })} />
                  </td>
                  <td className="r">
                    {isMaster && form.power_tiers.length > 1 && (
                      <button type="button" className="link-btn danger" onClick={() => set('power_tiers', form.power_tiers.filter((_, j) => j !== i))}>
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isMaster ? (
            <button type="button" className="btn btn-small" onClick={() => set('power_tiers', [...form.power_tiers, { min: 0, points: 0 }])}>
              + 구간 추가
            </button>
          ) : (
            <p className="muted small">점수 기준은 문주만 바꿀 수 있습니다.</p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">활동 1회 기본 점수</h2>
          <p className="muted small">참여 기록 화면에서 이 점수가 자동으로 채워집니다. 기록할 때마다 바꿀 수도 있습니다.</p>
          {ACTIVITIES.map((a) => (
            <label key={a.key} className="field">
              <span>
                {a.icon} {a.label}
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
          <h2 className="panel-title">주간 결산 보너스</h2>
          <p className="muted small">전투력·주간 결산 탭에서 결산할 때 지급됩니다. 동점이면 모두 받고, 0점이면 지급하지 않습니다.</p>
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
