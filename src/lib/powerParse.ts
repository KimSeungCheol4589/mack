// 스크린샷에서 읽은 글자에서 닉네임과 전투력을 찾아냅니다.
import type { OcrRow } from './ocr';

/** 닉네임으로 찾을 대상 (명단) */
export interface Named {
  id: string;
  nickname: string;
}

/** '48,210' '48.210' '48210' '241.65K' '1.2M' 같은 숫자를 찾습니다. (OCR 이 쉼표를 마침표로 읽는 경우 포함) */
export function findNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([KkMm만])?/g;
  for (const m of text.matchAll(re)) {
    const [, raw, unit] = m;
    let n: number;
    if (unit) {
      n = parseFloat(raw.replace(/,/g, '')) * (unit === '만' ? 10_000 : /[Kk]/.test(unit) ? 1_000 : 1_000_000);
    } else if (/[,.]\d{3}$/.test(raw) && /^\d{1,3}([,.]\d{3})+$/.test(raw)) {
      n = Number(raw.replace(/[,.]/g, ''));
    } else {
      n = Number(raw);
    }
    if (Number.isFinite(n)) out.push(Math.round(n));
  }
  return out;
}

/** 비교용: 공백·기호를 빼고 소문자로 */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** 행 글자 안에 닉네임이 얼마나 비슷하게 들어 있는지 (0~1). 같은 길이 구간을 밀어 가며 가장 비슷한 곳을 찾음 */
export function nicknameScore(rowText: string, nickname: string): number {
  const row = normalize(rowText.replace(/\d[\d,.]*/g, ''));
  const nick = normalize(nickname);
  if (!nick || !row) return 0;
  if (row.includes(nick)) return 1;
  let best = 0;
  for (const len of [nick.length - 1, nick.length, nick.length + 1]) {
    if (len < 1) continue;
    for (let i = 0; i + len <= row.length; i++) {
      const part = row.slice(i, i + len);
      best = Math.max(best, 1 - levenshtein(part, nick) / Math.max(part.length, nick.length));
    }
  }
  return best;
}

export interface PowerMatch<T extends Named = Named> {
  member: T;
  value: number;
  score: number;
  rowText: string;
}

/**
 * 문파원 목록 스크린샷의 행들을 문파원과 연결합니다.
 * 각 행에서 가장 비슷한 닉네임을 찾고, 그 행(없으면 바로 아래 행)의 가장 큰 숫자를 전투력으로 봅니다.
 * minPower 보다 작은 숫자(레벨, 순위 등)는 전투력 후보에서 뺍니다.
 */
export function matchPowers<T extends Named>(rows: OcrRow[], members: T[], minPower = 1000): { matches: PowerMatch<T>[]; unmatched: string[] } {
  const best = new Map<string, PowerMatch<T>>();
  const unmatched: string[] = [];
  rows.forEach((row, i) => {
    let top: { member: T; score: number } | null = null;
    for (const m of members) {
      const score = nicknameScore(row.text, m.nickname);
      if (!top || score > top.score) top = { member: m, score };
    }
    const powerIn = (text: string) => findNumbers(text).filter((n) => n >= minPower);
    let nums = powerIn(row.text);
    if (!nums.length && rows[i + 1] && findNumbers(rows[i + 1].text).length) nums = powerIn(rows[i + 1].text);
    const threshold = top && normalize(top.member.nickname).length <= 2 ? 0.99 : 0.6;
    if (top && top.score >= threshold && nums.length) {
      const value = Math.max(...nums);
      const prev = best.get(top.member.id);
      if (!prev || top.score > prev.score) best.set(top.member.id, { member: top.member, value, score: top.score, rowText: row.text });
    } else if (powerIn(row.text).length || (top && top.score >= 0.5)) {
      unmatched.push(row.text);
    }
  });
  return { matches: [...best.values()], unmatched };
}
