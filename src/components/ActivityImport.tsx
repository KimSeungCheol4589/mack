import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { readScreenshot } from '../lib/ocr';
import { matchNames } from '../lib/powerParse';
import { ACTIVITIES, type ActivityKey, type RosterMember } from '../lib/types';
import { addDays, today, weekLabel, weekStart } from '../lib/week';

interface Row {
  member: RosterMember;
  found: boolean;
  sure: boolean;
  checked: boolean;
  rowText: string;
}

/** 운영진용: 콘텐츠·디코 참여자 스크린샷으로 참여 기록을 한 번에 체크 */
export function ActivityImport({ onSaved }: { onSaved?: () => void }) {
  const members = useLoad(() => api.listRoster());
  const current = weekStart(today());
  const [week, setWeek] = useState(current);
  const [kind, setKind] = useState<ActivityKey>('yosin');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const multi = ACTIVITIES.find((a) => a.key === kind)?.multi;

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

  function reset() {
    setFiles([]);
    setRows(null);
  }

  async function analyze() {
    const allRows = [];
    for (const [i, f] of files.entries()) {
      setProgress(`${i + 1}/${files.length}장 읽는 중… (처음 한 번은 글자 인식 데이터를 내려받느라 조금 걸립니다)`);
      allRows.push(...(await readScreenshot(f, (p) => setProgress(`${i + 1}/${files.length}장 읽는 중… ${Math.round(p * 100)}%`))));
    }
    const matches = new Map(matchNames(allRows, list).map((m) => [m.member.id, m]));
    setRows(
      list
        .map((m) => {
          const hit = matches.get(m.id);
          return { member: m, found: !!hit, sure: (hit?.score ?? 0) >= 1, checked: !!hit, rowText: hit?.rowText ?? '' };
        })
        .sort((a, b) => Number(b.found) - Number(a.found) || a.member.nickname.localeCompare(b.member.nickname, 'ko')),
    );
    setProgress(null);
  }

  async function save(picked: Row[]) {
    const acts = await api.listActivities(week);
    for (const r of picked) {
      const before = acts[r.member.id]?.[kind] ?? 0;
      // 디코는 이번 스크린샷 묶음을 참여 1회로 더하고, 나머지 콘텐츠는 주 1회 체크
      const count = multi ? before + 1 : 1;
      if (count !== before) await api.setActivity(r.member.id, kind, week, count);
    }
  }

  const picked = (rows ?? []).filter((r) => r.checked);
  const found = (rows ?? []).filter((r) => r.found).length;
  const label = ACTIVITIES.find((a) => a.key === kind)!.label;

  return (
    <section className="panel">
      <h2 className="panel-title">📸 스크린샷으로 참여 체크</h2>
      <ol className="steps muted small">
        <li>주와 콘텐츠를 고릅니다.</li>
        <li>게임 참여자 화면(디코는 참여자 목록)을 닉네임이 보이게 캡처해 고르거나 Ctrl+V 로 붙여 넣고 <strong>읽기</strong>를 누릅니다.</li>
        <li>찾은 문파원을 확인하고 빠진 사람은 직접 체크한 뒤 저장합니다. 이미지는 이 브라우저에서만 처리되고 업로드되지 않습니다.</li>
        <li>디코는 한 번 저장할 때마다 체크한 사람의 참여 횟수가 1회씩 늘어납니다. 한 번의 디코 참여는 여러 장이어도 한 번에 올려 주세요.</li>
      </ol>
      <div className="row">
        <select className="input" style={{ width: 'auto' }} value={week} onChange={(e) => setWeek(e.target.value)}>
          {[0, 1, 2, 3].map((n) => {
            const w = addDays(current, -7 * n);
            return (
              <option key={w} value={w}>
                {weekLabel(w)}
                {n === 0 ? ' (이번 주)' : ''}
              </option>
            );
          })}
        </select>
        <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as ActivityKey)}>
          {ACTIVITIES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.icon} {a.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => setFiles((f) => [...f, ...(e.target.files ?? [])])} />
        <button className="btn" onClick={() => inputRef.current?.click()}>
          스크린샷 고르기
        </button>
        {files.length > 0 && (
          <>
            <span className="muted small">{files.length}장 선택됨</span>
            <button className="link-btn" onClick={reset}>
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

      {rows && (
        <>
          <div className="panel-title-row" style={{ marginTop: 16 }}>
            <h3 className="panel-title">
              {label} <span className="muted small">{found}명 찾음 · {picked.length}명 체크</span>
            </h3>
            <button
              className="btn btn-red"
              disabled={busy || !picked.length}
              onClick={() =>
                run(async () => {
                  await save(picked);
                  onSaved?.();
                  reset();
                }, `${weekLabel(week)} ${label}: ${picked.length}명 ${multi ? '참여 1회 추가' : '참여 체크'}`)
              }
            >
              {picked.length}명 저장
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>닉네임</th>
                  <th>결과</th>
                  <th>읽은 줄</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.member.id} className={r.found && !r.sure ? 'odd-row' : undefined}>
                    <td>
                      <input type="checkbox" checked={r.checked} onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
                    </td>
                    <td className="strong">{r.member.nickname}</td>
                    <td className="small">{r.found ? (r.sure ? '찾음' : '비슷함 · 확인 필요') : <span className="muted">못 찾음</span>}</td>
                    <td className="muted small ocr-text">{r.rowText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
