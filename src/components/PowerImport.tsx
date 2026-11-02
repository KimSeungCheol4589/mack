import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { readScreenshot } from '../lib/ocr';
import { matchPowers } from '../lib/powerParse';
import type { RosterMember } from '../lib/types';

interface Row {
  member: RosterMember;
  value: string;
  checked: boolean;
  rowText: string;
}

/** 운영진용: 게임 문파원 목록 스크린샷 여러 장으로 전체 전투력을 한 번에 갱신 */
export function PowerImport({ onSaved }: { onSaved?: () => void }) {
  const members = useLoad(() => api.listRoster());
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  // Ctrl+V 로 붙여 넣은 이미지도 받음
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (imgs.length) setFiles((f) => [...f, ...imgs]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const list = (members.data ?? []).filter((m) => m.active);

  async function analyze() {
    const allRows = [];
    for (const [i, f] of files.entries()) {
      setProgress(`${i + 1}/${files.length}장 읽는 중… (처음 한 번은 글자 인식 데이터를 내려받느라 조금 걸립니다)`);
      allRows.push(...(await readScreenshot(f, (p) => setProgress(`${i + 1}/${files.length}장 읽는 중… ${Math.round(p * 100)}%`))));
    }
    const { matches, unmatched } = matchPowers(allRows, list);
    setRows(
      matches
        .sort((a, b) => b.value - a.value)
        .map((m) => ({ member: m.member, value: String(m.value), checked: m.value !== m.member.combat_power, rowText: m.rowText })),
    );
    setUnmatched(unmatched);
    setProgress(null);
  }

  const found = new Set(rows?.map((r) => r.member.id));
  const missing = list.filter((m) => !found.has(m.id));
  const toSave = (rows ?? []).filter((r) => r.checked && Number(r.value) > 0);

  return (
    <div className="power-import">
      <section className="panel">
        <h2 className="panel-title">📸 스크린샷으로 전투력 갱신</h2>
        <ol className="steps muted small">
          <li>게임에서 문파원 목록을 열고, 닉네임과 전투력이 보이게 스크롤하며 여러 장 캡처합니다.</li>
          <li>아래에 파일을 고르거나 Ctrl+V 로 붙여 넣고 <strong>읽기</strong>를 누릅니다.</li>
          <li>읽은 값을 확인·수정한 뒤 저장합니다. 이미지는 이 브라우저에서만 처리되고 업로드되지 않습니다.</li>
          <li>매주 수요일에 갱신하고, 아래 <strong>주간 결산</strong>으로 지난 주 엽전 분배와 최고 전투력·최고 성장 보너스를 줍니다.</li>
        </ol>
        <div className="row">
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => setFiles((f) => [...f, ...(e.target.files ?? [])])} />
          <button className="btn" onClick={() => inputRef.current?.click()}>
            스크린샷 고르기
          </button>
          {files.length > 0 && (
            <>
              <span className="muted small">{files.length}장 선택됨</span>
              <button className="link-btn" onClick={() => { setFiles([]); setRows(null); setUnmatched([]); }}>
                비우기
              </button>
            </>
          )}
          <button className="btn btn-red" disabled={!files.length || !!progress || !members.data} onClick={() => run(analyze)}>
            읽기
          </button>
        </div>
        {files.length > 0 && (
          <div className="thumbs">
            {files.map((f, i) => (
              <img key={i} src={URL.createObjectURL(f)} alt={`스크린샷 ${i + 1}`} />
            ))}
          </div>
        )}
        {progress && <p className="week-note">{progress}</p>}
      </section>

      {rows && (
        <section className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">
              읽은 결과 <span className="muted small">{rows.length}명 인식 · 바뀐 값 {rows.filter((r) => Number(r.value) !== r.member.combat_power).length}명</span>
            </h2>
            <button
              className="btn btn-red"
              disabled={busy || !toSave.length}
              onClick={() =>
                run(async () => {
                  await api.setPowers(toSave.map((r) => ({ id: r.member.id, combat_power: Math.floor(Number(r.value)) })));
                  members.reload();
                  onSaved?.();
                  setRows((rs) => rs!.filter((r) => !toSave.includes(r)));
                }, `${toSave.length}명의 전투력을 갱신했습니다`)
              }
            >
              {toSave.length}명 저장
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>닉네임</th>
                  <th className="r">현재</th>
                  <th className="r">읽은 값</th>
                  <th className="r">변화</th>
                  <th>읽은 줄</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const v = Number(r.value);
                  const diff = v - r.member.combat_power;
                  // 갑자기 크게 줄거나 늘면 잘못 읽었을 수 있으니 표시
                  const odd = r.member.combat_power > 0 && (v < r.member.combat_power * 0.9 || v > r.member.combat_power * 1.5);
                  const set = (patch: Partial<Row>) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.member.id} className={odd ? 'odd-row' : undefined}>
                      <td>
                        <input type="checkbox" checked={r.checked} onChange={(e) => set({ checked: e.target.checked })} />
                      </td>
                      <td className="strong">{r.member.nickname}</td>
                      <td className="r num muted">{fmt(r.member.combat_power)}</td>
                      <td className="r">
                        <input className="input input-small num" inputMode="numeric" value={r.value} onChange={(e) => set({ value: e.target.value.replace(/\D/g, ''), checked: true })} />
                      </td>
                      <td className={`r num ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'muted'}`}>
                        {diff > 0 ? `▲ ${fmt(diff)}` : diff < 0 ? `▼ ${fmt(-diff)}` : '-'}
                        {odd && <div className="small">확인 필요</div>}
                      </td>
                      <td className="muted small ocr-text">{r.rowText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <p className="muted small">
              못 찾은 문파원 ({missing.length}명): {missing.map((m) => m.nickname).join(', ')} — 해당 부분을 더 캡처하거나 명단 관리에서 직접 입력하세요.
            </p>
          )}
          {unmatched.length > 0 && (
            <details className="muted small">
              <summary>문파원과 연결하지 못한 줄 {unmatched.length}개</summary>
              <ul className="ocr-lines">
                {unmatched.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
