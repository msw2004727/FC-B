import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/**
 * 允許 target="_blank"、window.open 的 _blank／noopener、或把 target 設成 _blank 的檔案。值是原因。
 * 具名視窗且沒有 _blank／noopener（例如 line-notify-bind 的 sporthub_line）不在這份清單，掃描也不會命中。
 */
const BLANK_ALLOWLIST: Record<string, string> = {
  'src/core/open-external.ts':
    'openStaticPage：iOS Mini App 與 PWA 全螢幕進靜態頁（說明書、角色說明、隱私、條款）若整頁過去會回不來，所以這一種情況維持 window.open(_blank, noopener)。其他環境改 location.assign。',
  'src/features/profile/components/legacy/LegacyFirstLoginModal.tsx':
    '首次登入表單的條款／隱私維持另開：同分頁會丟掉尚未送出的表單。這是站內頁，不用 openExternal。',
  'src/features/inbox/components/pm-message-format.tsx':
    '站內信是使用者自填的任意網址。window.open 在部分瀏覽器回傳 null 時清不掉 opener，反向分頁劫持由對方控制，所以保留 rel="noopener noreferrer" 的另開。',
  'src/features/events/data/event-share.ts':
    'line.me 分享網址維持原行為，不是一般外連。Mini App 的 Flex 分享走既有 shareTargetPicker，不另寫流程。',
  'src/features/events/components/AttendanceRosterTable.tsx':
    '施工卡禁止修改：名單改版分支在改。「到舊版」目前不顯示，之後再處理。',
  'src/features/events/components/UnregRosterTable.tsx':
    '施工卡禁止修改：名單改版分支在改。「到舊版」目前不顯示，之後再處理。',
};

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function skipped(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? '';
  return base.includes('.test.');
}

/** 註解換成空白但保留換行，行號才對得上原檔。字串裡的 // 與斜線不當註解。 */
function maskComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1];
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch;
      i += 1;
      while (i < source.length) {
        const c = source[i] ?? '';
        out += c;
        if (c === '\\') {
          if (i + 1 < source.length) out += source[i + 1];
          i += 2;
          continue;
        }
        i += 1;
        if (c === ch) break;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 從 openParen 這個 '(' 配對到呼叫結束，字串與內層括號都算進去。 */
function endOfCall(source: string, openParen: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineNo(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function blankHits(source: string): number[] {
  const masked = maskComments(source);
  const hits = new Set<number>();
  const mark = (pattern: RegExp): void => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(masked))) {
      hits.add(lineNo(masked, match.index));
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  };
  mark(/target\s*=\s*["']_blank["']/g);
  mark(/target\s*=\s*\{\s*["']_blank["']\s*\}/g);
  mark(/\.target\s*=\s*["']_blank["']/g);
  mark(/setAttribute\(\s*["']target["']\s*,\s*["']_blank["']\s*\)/g);

  const openPattern = /window\.open\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = openPattern.exec(masked))) {
    const openParen = match.index + match[0].length - 1;
    const end = endOfCall(masked, openParen);
    const call = end === -1 ? masked.slice(match.index, match.index + 500) : masked.slice(match.index, end + 1);
    if (call.includes("'_blank'") || call.includes('"_blank"') || call.includes('noopener')) {
      hits.add(lineNo(masked, match.index));
    }
  }
  return [...hits].sort((a, b) => a - b);
}

describe('外連契約', () => {
  it('白名單都寫了原因', () => {
    for (const reason of Object.values(BLANK_ALLOWLIST)) {
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('window.open 的 _blank 能跨過內層括號', () => {
    const source = "window.open('https://line.me/R/share?text=' + encodeURIComponent(x), '_blank');";
    expect(blankHits(source)).toEqual([1]);
  });

  it('window.open 帶 noopener、.target = _blank、setAttribute(target,_blank) 都算', () => {
    const source = [
      "window.open(url, 'name', 'noopener');",
      "link.target = '_blank';",
      "el.setAttribute('target', '_blank');",
      "node.setAttribute(\"target\", \"_blank\");",
      'window.open(url, name);',
    ].join('\n');
    expect(blankHits(source)).toEqual([1, 2, 3, 4]);
  });

  it('白名單每一筆都真的有命中', () => {
    const misses: string[] = [];
    for (const relPath of Object.keys(BLANK_ALLOWLIST)) {
      const hits = blankHits(readFileSync(join(process.cwd(), relPath), 'utf8'));
      if (hits.length === 0) misses.push(relPath);
    }
    expect(misses).toEqual([]);
  });

  it('src 除白名單外不得 target=_blank、window.open _blank／noopener、或把 target 設成 _blank', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const relPath = toPosix(relative(process.cwd(), file));
      if (skipped(relPath)) continue;
      const hits = blankHits(readFileSync(file, 'utf8'));
      if (hits.length === 0) continue;
      if (BLANK_ALLOWLIST[relPath]) continue;
      violations.push(`${relPath}:${hits.join(',')}`);
    }
    expect(violations).toEqual([]);
  });
});
