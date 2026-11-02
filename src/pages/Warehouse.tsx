import { useState } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import { MemberGate } from '../components/Layout';
import { api, fmt, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useLoad } from '../lib/hooks';
import { STATUS_LABEL, type Item } from '../lib/types';

export function Warehouse() {
  return (
    <MemberGate>
      <WarehouseInner />
    </MemberGate>
  );
}

function WarehouseInner() {
  const { myRoster, refreshMe } = useAuth();
  const items = useLoad(() => api.listItems());
  const requests = useLoad(() => (myRoster ? api.listRequests(myRoster.id) : Promise.resolve([])), [myRoster?.id]);
  const [category, setCategory] = useState('전체');
  const [picked, setPicked] = useState<Item | null>(null);
  const { busy, run } = useAction();

  const pending = (requests.data ?? []).filter((r) => r.status === 'pending').reduce((s, r) => s + r.total_cost, 0);
  const coins = myRoster?.coins ?? 0;
  const available = coins - pending;
  const active = (items.data ?? []).filter((i) => i.active);
  const categories = ['전체', ...new Set(active.map((i) => i.category))];
  const shown = active.filter((i) => category === '전체' || i.category === category);

  const reload = () => {
    items.reload();
    requests.reload();
    refreshMe();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>문파창고</h1>
        <p className="muted">문파 상점에서 사 둔 물품을 문파 엽전으로 신청하세요. 운영진이 승인하면 엽전이 차감되고 게임에서 지급됩니다.</p>
      </div>

      <div className="wallet panel">
        <div>
          <span className="stat-label">보유 엽전</span>
          <span className="stat-value">{fmt(coins)}</span>
        </div>
        <div>
          <span className="stat-label">승인 대기 중</span>
          <span className="stat-value muted">-{fmt(pending)}</span>
        </div>
        <div>
          <span className="stat-label">사용 가능</span>
          <span className="stat-value up">{fmt(available)}</span>
        </div>
      </div>

      {!myRoster && (
        <p className="recruit">
          아직 문파원 명단과 연결되지 않은 계정입니다. 내 정보에서 닉네임을 게임 닉네임과 똑같이 맞추면 자동으로 연결되고, 안 되면 운영진에게 연결을 요청하세요.
        </p>
      )}

      <div className="tabs" role="tablist">
        {categories.map((c) => (
          <button key={c} role="tab" aria-selected={c === category} className={c === category ? 'tab active' : 'tab'} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      {items.error && <p className="error">{items.error}</p>}
      <div className="items">
        {shown.map((item) => (
          <article key={item.id} className={`item panel${item.stock === 0 ? ' sold-out' : ''}`}>
            <ItemIcon icon={item.icon} />
            <div className="item-body">
              <h3>{item.name}</h3>
              <p className="muted small">{item.description}</p>
              <div className="item-meta">
                <span className="cost">🪙 {fmt(item.cost)}전</span>
                <span className="muted small">재고 {fmt(item.stock)}</span>
              </div>
            </div>
            <button className="btn btn-red btn-small" disabled={item.stock === 0 || item.cost > available} onClick={() => setPicked(item)}>
              {item.stock === 0 ? '품절' : item.cost > available ? '엽전 부족' : '신청'}
            </button>
          </article>
        ))}
        {items.data && shown.length === 0 && <p className="muted">창고가 비어 있습니다.</p>}
      </div>

      <section className="panel">
        <h2 className="panel-title">내 신청 내역</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>신청일</th>
                <th>아이템</th>
                <th className="r">수량</th>
                <th className="r">엽전</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(requests.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="muted">{fmtDate(r.created_at)}</td>
                  <td>
                    <ItemIcon icon={r.item_icon} className="mini-icon" /> {r.item_name}
                    {r.note && <div className="muted small">{r.note}</div>}
                  </td>
                  <td className="r num">{r.quantity}</td>
                  <td className="r num">{fmt(r.total_cost)}</td>
                  <td>
                    <span className={`status status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="r">
                    {r.status === 'pending' && (
                      <button className="link-btn" disabled={busy} onClick={() => run(() => api.cancelRequest(r.id), '신청을 취소했습니다').then(reload)}>
                        취소
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {requests.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    아직 신청한 아이템이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {picked && (
        <RequestDialog
          item={picked}
          available={available}
          onClose={() => setPicked(null)}
          onDone={() => {
            setPicked(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function RequestDialog({ item, available, onClose, onDone }: { item: Item; available: number; onClose: () => void; onDone: () => void }) {
  const max = Math.max(1, Math.min(item.stock, item.cost > 0 ? Math.floor(available / item.cost) : item.stock));
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const total = qty * item.cost;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label={`${item.name} 신청`} onClick={(e) => e.stopPropagation()}>
        <h2 className="panel-title">
          <ItemIcon icon={item.icon} className="mini-icon" /> {item.name} 신청
        </h2>
        <label className="field">
          <span>수량 (최대 {max})</span>
          <input className="input" type="number" min={1} max={max} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
        </label>
        <label className="field">
          <span>메모 (선택)</span>
          <input className="input" placeholder="예: 무기 강화용" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="total">
          필요 엽전 <strong>{fmt(total)}전</strong> <span className="muted">/ 사용 가능 {fmt(available)}전</span>
        </p>
        <div className="row-end">
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <button
            className="btn btn-red"
            disabled={busy || total > available}
            onClick={async () => {
              if (await run(() => api.requestItem(item.id, qty, note.trim()), '신청했습니다. 운영진 승인을 기다려 주세요')) onDone();
            }}
          >
            신청하기
          </button>
        </div>
      </div>
    </div>
  );
}
