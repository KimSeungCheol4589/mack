// 엑셀(문파상점 시트 등)에서 복사해 붙여 넣은 명단을 읽습니다.
//   * 머리글 줄(직위 · 닉네임 · 전/전투력 · 현/전투력 · … · 누적엽전)이 있으면 그 칸 위치를 씁니다.
//   * 머리글이 없으면 '직위' 칸을 기준으로 시트와 같은 순서(직위, 닉네임, 전, 현, 성장, 요신, 결계지, 신기, 미혹, 디코, 점수총합, 누적엽전)로 봅니다.
//   * 직위가 없는 '닉네임 전투력' 줄은 문파원으로 넣습니다.
import { RANKS, type Rank, type RosterImportRow } from './types';

const num = (s: string | undefined): number | null => {
  const t = (s ?? '').replace(/[,\s전]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
};

const isRank = (s: string): s is Rank => (RANKS as string[]).includes(s.trim());

interface Cols {
  rank: number;
  nick: number;
  prev: number;
  power: number;
  coins: number;
}

function headerCols(cells: string[]): Cols | null {
  const at = (re: RegExp) => cells.findIndex((c) => re.test(c.replace(/\s/g, '')));
  const nick = at(/닉네임/);
  if (nick < 0) return null;
  return { rank: at(/직위/), nick, prev: at(/^전\/?전투력|^전$/), power: at(/^현\/?전투력|^현$|^전투력$/), coins: at(/누적/) };
}

export function parseRosterPaste(text: string): { rows: RosterImportRow[]; skipped: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let cols: Cols | null = null;
  const rows = new Map<string, RosterImportRow>();
  const skipped: string[] = [];

  for (const line of lines) {
    const cells = (line.includes('\t') ? line.split('\t') : line.trim().split(/\s{2,}|\s(?=\d)/)).map((c) => c.trim());
    const head = headerCols(cells);
    if (head) {
      cols = head;
      continue;
    }
    // 직위·숫자만 있고 닉네임이 빈 줄은 시트의 빈 칸이므로 조용히 넘어감
    if (cells.every((c) => !c || isRank(c) || num(c) !== null || c === '-')) continue;
    let row: RosterImportRow | null = null;
    if (cols) {
      const nickname = cells[cols.nick] ?? '';
      const rank = cols.rank >= 0 && isRank(cells[cols.rank] ?? '') ? (cells[cols.rank].trim() as Rank) : '문파원';
      const power = (cols.power >= 0 ? num(cells[cols.power]) : null) || (cols.prev >= 0 ? num(cells[cols.prev]) : null) || 0;
      if (nickname && num(nickname) === null) row = { nickname, rank, combat_power: power, coins: cols.coins >= 0 ? num(cells[cols.coins]) : null };
    } else {
      const r = cells.findIndex(isRank);
      if (r >= 0 && cells[r + 1]) {
        const power = num(cells[r + 3]) || num(cells[r + 2]) || 0;
        row = { nickname: cells[r + 1], rank: cells[r].trim() as Rank, combat_power: power, coins: cells.length > r + 11 ? num(cells[r + 11]) : null };
      } else {
        const name = cells.find((c) => c && num(c) === null && !isRank(c));
        const nums = cells.map(num).filter((n): n is number => n !== null);
        if (name) row = { nickname: name, rank: '문파원', combat_power: nums.length ? Math.max(...nums) : 0, coins: null };
      }
    }
    if (row && row.nickname.length <= 20) rows.set(row.nickname, row);
    else skipped.push(line.trim());
  }
  return { rows: [...rows.values()], skipped };
}
