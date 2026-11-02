// 스크린샷에서 읽은 글자에서 닉네임과 전투력을 찾아냅니다.
import type { OcrRow } from './ocr';
import type { Rank } from './types';

/** 닉네임으로 찾을 대상 (명단) */
export interface Named {
  id: string;
  nickname: string;
}

/** '48,210' '48.210' '48210' '241.65K' '1.2M' 같은 숫자를 찾습니다. (OCR 이 쉼표를 마침표로 읽는 경우 포함) */
export function findNumbers(text: string): number[] {
  text = fixDigits(text);
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

/**
 * 게임 글꼴의 9 를 OCR 이 '?' 로 읽는 경우: '28?,557' → '289,557'.
 * 9 로 바꿔 '123,456' 꼴이 되면 9, 아니면 군더더기로 보고 지움 ('269?,782' → '269,782').
 */
export function fixDigits(text: string): string {
  // 게임은 전투력을 쉼표와 함께 보여 주므로, 쉼표 없이 7자리 이상이면 닉네임 글자가 숫자로 붙은 것 ('1874242' → '187424')
  text = text.replace(/(^|[^\d,.])(\d{6})\d+(?![\d,.])/g, '$1$2');
  return text.replace(/\d[\d?,.]*\?[\d?,.]*/g, (tok) => {
    const nine = tok.replace(/\?/g, '9').replace(/[,.]$/, '');
    return /^\d{1,3}([,.]\d{3})+$/.test(nine) ? nine : tok.replace(/\?/g, '');
  });
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

/** 게임 문파원 목록처럼 한 줄에 카드가 두 개('전투력 289,557 쌕 | 전투력 329,757 넛티')면 카드별로 나눈 행 */
export interface CardRow extends OcrRow {
  /** 카드 위 줄의 직위 배지 (문주 → 문파장, 부문주 → 부문파장) */
  rank?: Rank;
  /** 전투력 숫자 뒤의 닉네임 글자 */
  name?: string;
}

function rankOf(text: string): Rank | undefined {
  if (/부\s*문/.test(text)) return '부문파장';
  if (/문\s*주/.test(text)) return '문파장';
  if (/문\s*파\s*원/.test(text)) return '문파원';
  // 직위 배지 글자를 못 읽었지만 왕관(Ww 로 읽힘)이 있으면 문주 아니면 부문주
  if (/(^|\s)W[ws]?(\s|$)/.test(text)) return '부문파장';
  return undefined;
}

const isPowerNumber = (t: string) => /^\d{2,3}[,.]\d{3}/.test(fixDigits(t)) || /^\d{6,}$/.test(fixDigits(t));
/** '…' 버튼 같은 기호뿐인 글자 */
const isJunk = (t: string) => !/[0-9A-Za-z가-힣ㄱ-ㅎ]/.test(t);

/**
 * 게임 문파원 목록처럼 한 줄에 카드가 두 개('전투력 289,557 쌕 … | 전투력 329,757 넛티 …')면 카드별로 나눕니다.
 * '전투력' 글자는 TES 처럼 잘못 읽히기도 해서, 전투력 숫자를 기준으로 [이름표][숫자][닉네임…] 을 한 칸으로 봅니다.
 * 바로 위 행에서 같은 칸의 직위 배지도 찾습니다.
 */
export function splitCards(rows: OcrRow[]): CardRow[] {
  const out: CardRow[] = [];
  rows.forEach((row, i) => {
    const nums = row.words.map((w, j) => (isPowerNumber(w.text) ? j : -1)).filter((j) => j >= 0);
    if (!nums.length) return out.push(row);
    // 숫자 바로 앞 단어는 '전투력' 이름표
    const starts = nums.map((j, k) => (j > 0 && (k === 0 || j - 1 > nums[k - 1]) && !isPowerNumber(row.words[j - 1].text) ? j - 1 : j));
    starts.forEach((start, k) => {
      const end = starts[k + 1] ?? row.words.length;
      const words = row.words.slice(start, end);
      const numAt = nums[k] - start;
      const x0 = words[0].x0;
      const x1 = starts[k + 1] !== undefined ? row.words[starts[k + 1]].x0 : Infinity;
      const pad = (words[numAt].x0 - x0) / 2 + 10;
      const above = rows[i - 1]?.words.filter((w) => w.x0 >= x0 - pad && w.x0 < x1 - pad) ?? [];
      const name = words
        .slice(numAt + 1)
        .filter((w) => !isJunk(w.text))
        .map((w) => w.text.replace(/[^0-9A-Za-z가-힣]/g, ''))
        .join('')
        .slice(0, 20);
      out.push({
        words,
        text: words.map((w) => fixDigits(w.text)).join(' '),
        y: row.y,
        rank: rankOf(above.map((w) => w.text).join(' ')),
        name,
      });
    });
  });
  return out;
}

/** 명단에 없는 닉네임 (새 문파원 후보) */
export interface NewEntry {
  nickname: string;
  value: number;
  rank: Rank;
  rowText: string;
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
export function matchPowers<T extends Named>(
  ocrRows: OcrRow[],
  members: T[],
  minPower = 1000,
): { matches: PowerMatch<T>[]; unmatched: string[]; newcomers: NewEntry[] } {
  const rows = splitCards(ocrRows);
  const best = new Map<string, PowerMatch<T>>();
  const unmatched: string[] = [];
  const newcomers = new Map<string, NewEntry>();
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
      // 카드로 나뉜 행이면 새 문파원 후보 (닉네임을 못 읽었으면 빈칸으로 두고 직접 입력)
      const value = Math.max(0, ...powerIn(row.text));
      const key = row.name || `#${i}`;
      if (row.name !== undefined && value && !newcomers.has(key)) newcomers.set(key, { nickname: row.name, value, rank: row.rank ?? '문파원', rowText: row.text });
      else unmatched.push(row.text);
    }
  });
  return { matches: [...best.values()], unmatched, newcomers: [...newcomers.values()] };
}

export interface NameMatch<T extends Named = Named> {
  member: T;
  score: number;
  rowText: string;
}

/**
 * 콘텐츠·디코 참여자 스크린샷에서 명단의 닉네임을 찾습니다. 숫자 단서가 없으니 전투력보다 엄격하게 봅니다
 * (두 글자 이하는 정확히 같아야, 그 밖에는 80% 이상 비슷해야 찾은 것으로 봄).
 */
export function matchNames<T extends Named>(rows: OcrRow[], members: T[]): NameMatch<T>[] {
  const out: NameMatch<T>[] = [];
  for (const m of members) {
    let best: NameMatch<T> | null = null;
    for (const row of rows) {
      const score = nicknameScore(row.text, m.nickname);
      if (!best || score > best.score) best = { member: m, score, rowText: row.text };
    }
    const threshold = normalize(m.nickname).length <= 2 ? 0.99 : 0.8;
    if (best && best.score >= threshold) out.push(best);
  }
  return out;
}
