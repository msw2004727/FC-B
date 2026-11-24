import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PADDED_DATE_NOTE,
  QUERY_LIMIT_REGISTRY,
  UNBOUNDED_QUERY_WATCH,
  type QueryLimitEntry,
} from './query-limit-registry';

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');

const STATUSES = new Set(['ok', 'known-gap-batch-D', 'known-gap-batch-E', 'known-gap-other']);
const REGEX_PREFIX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof',
]);

/**
 * 把註解（`//`、`/* *\/`、JSDoc）與字串、樣板字串、正規表示式的內容換成空白，保留換行與 `${}` 裡的程式。
 * 單／雙引號字串遇到換行就結束（JS 字串不能跨行；JSX 文字裡的撇號不會一路吃到檔尾）。
 */
export function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  // 樣板字串堆疊：每層記錄 `${` 裡的大括號深度。
  const templateDepth: number[] = [];
  let lastSignificant = '';
  let lastWord = '';

  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');
  const regexAllowed = (): boolean => {
    if (lastSignificant === '') return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant)) return true;
    return /[\w$]/.test(lastSignificant) && REGEX_PREFIX_KEYWORDS.has(lastWord);
  };

  const readTemplateBody = (): void => {
    // i 指在樣板字串內容；讀到結尾 ` 或 `${` 為止。
    while (i < n) {
      const ch = source[i]!;
      if (ch === '\\') {
        out += blank(ch) + blank(source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '`') {
        out += '`';
        i += 1;
        lastSignificant = '`';
        lastWord = '';
        return;
      }
      if (ch === '$' && source[i + 1] === '{') {
        out += '${';
        i += 2;
        templateDepth.push(0);
        lastSignificant = '{';
        lastWord = '';
        return;
      }
      out += blank(ch);
      i += 1;
    }
  };

  while (i < n) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += blank(source[i]!);
        i += 1;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '\'' || ch === '"') {
      out += ch;
      i += 1;
      while (i < n && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\' && source[i + 1] !== '\n') {
          out += '  ';
          i += 2;
          continue;
        }
        out += ' ';
        i += 1;
      }
      if (i < n && source[i] === ch) {
        out += ch;
        i += 1;
      }
      lastSignificant = ch;
      lastWord = '';
      continue;
    }
    if (ch === '`') {
      out += '`';
      i += 1;
      readTemplateBody();
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      out += '/';
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const c = source[i]!;
        if (c === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        out += ' ';
        i += 1;
      }
      if (i < n && source[i] === '/') {
        out += '/';
        i += 1;
      }
      lastSignificant = '/';
      lastWord = '';
      continue;
    }
    if (templateDepth.length > 0) {
      if (ch === '{') templateDepth[templateDepth.length - 1]! += 1;
      if (ch === '}') {
        if (templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          out += '}';
          i += 1;
          readTemplateBody();
          continue;
        }
        templateDepth[templateDepth.length - 1]! -= 1;
      }
    }

    out += ch;
    i += 1;
    if (/\s/.test(ch)) continue;
    if (/[\w$]/.test(ch)) {
      lastWord = /[\w$]/.test(lastSignificant) ? lastWord + ch : ch;
    } else {
      lastWord = '';
    }
    lastSignificant = ch;
  }
  return out;
}

const LIMIT_CALL_RE = /(?<![\w$])(limit(?:ToLast)?)\s*\(/g;

/** 數已去除註解與字串的程式碼裡有幾個 limit 呼叫；方法簽章與函式宣告不算。 */
export function countLimitCalls(source: string): number {
  const code = stripCommentsAndStrings(source);
  let count = 0;
  for (const match of code.matchAll(LIMIT_CALL_RE)) {
    const start = match.index;
    const before = code.slice(Math.max(0, start - 20), start);
    if (/\bfunction\s*$/.test(before)) continue;
    // 找對應的右括號。
    let depth = 0;
    let end = start + match[0].length - 1;
    for (; end < code.length; end += 1) {
      if (code[end] === '(') depth += 1;
      else if (code[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const args = code.slice(start + match[0].length, end);
    const after = code.slice(end + 1).match(/^\s*(\S)/)?.[1] ?? '';
    // 方法簡寫 `limit(n) { … }`，或型別簽章 `limit(n: number): T`。
    if (after === '{') continue;
    if (after === ':' && /^\s*[\w$]+\s*\??\s*:/.test(args)) continue;
    count += 1;
  }
  return count;
}

function isProductionSource(rel: string): boolean {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(rel)) return false;
  if (/\.d\.ts$/.test(rel)) return false;
  if (/\.(test|spec)\.[^/]+$/.test(rel)) return false;
  if (rel.startsWith('src/dev/')) return false;
  if (rel.split('/').some((part) => part === '__fixtures__' || part === '__mocks__')) return false;
  if (/^src\/test-setup[^/]*$/.test(rel)) return false;
  return true;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function scanSrc(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const full of walk(SRC)) {
    const rel = relative(ROOT, full).split('\\').join('/');
    if (!isProductionSource(rel)) continue;
    const source = readFileSync(full, 'utf8');
    if (!/limit/.test(source)) continue;
    const n = countLimitCalls(source);
    if (n > 0) counts.set(rel, n);
  }
  return counts;
}

const sitesOf = (entry: QueryLimitEntry): number => entry.sites ?? 1;

describe('countLimitCalls（掃描器本身）', () => {
  it('不算 // 與 /* */、JSDoc 註解裡的 limit(', () => {
    const src = [
      '// fs.limit(1)',
      '/** 照 A `limit(200)` */',
      '/* sdk.limit(3)',
      '   limit(4) */',
      'const q = query(col, limit(5));',
    ].join('\n');
    expect(countLimitCalls(src)).toBe(1);
  });

  it('不算字串、樣板字串文字與正規表示式裡的 limit(，但算 ${} 裡的呼叫', () => {
    const src = [
      "const a = 'limit(1)';",
      'const b = "fs.limit(2)";',
      'const c = `limit(3) ${fs.limit(4)} done`;',
      'const d = /limit\\(5\\)/.test(x);',
      "const e = x / 2; const f = sdk.limit(6); // '",
    ].join('\n');
    expect(countLimitCalls(src)).toBe(2);
  });

  it('算 fs.limit、sdk.limit、limitToLast 與三元兩支；不算 fsLimit、setLimit', () => {
    const src = [
      'const q = c ? query(b, startAfter(x), limit(n)) : query(b, limit(n));',
      'sdk.limit(CP_READ_LIMIT.mine);',
      'fs.limit(Math.min(LIMIT, 60));',
      'limitToLast(3);',
      'fsLimit(1); setLimit(2); rateLimit (3);',
    ].join('\n');
    expect(countLimitCalls(src)).toBe(5);
  });

  it('不算介面方法簽章、方法簡寫與函式宣告', () => {
    const src = [
      'interface Sdk {',
      '  limit(n: number): unknown;',
      '  limit?(n?: number): unknown;',
      '}',
      'const fake = { limit(n) { return n; } };',
      'function limit(n) { return n; }',
      'const ok = cond ? limit(1) : limit(2);',
    ].join('\n');
    expect(countLimitCalls(src)).toBe(2);
  });

  it('JSX 文字裡的撇號不會吃掉後面的程式', () => {
    const src = [
      'const el = <p>It\'s fine</p>;',
      'const q = query(col, limit(1));',
    ].join('\n');
    expect(countLimitCalls(src)).toBe(1);
  });
});

describe('帶筆數上限的查詢登記表', () => {
  const scanned = scanSrc();

  it('掃到的檔案集合等於登記表的檔案集合', () => {
    const unregistered = [...scanned.keys()].filter((file) => !(file in QUERY_LIMIT_REGISTRY)).sort();
    const stale = Object.keys(QUERY_LIMIT_REGISTRY).filter((file) => !scanned.has(file)).sort();
    expect({ unregistered, stale }).toEqual({ unregistered: [], stale: [] });
  });

  it('每個檔的 limit 呼叫數等於登記數', () => {
    const mismatched = Object.entries(QUERY_LIMIT_REGISTRY)
      .filter(([file, item]) => scanned.has(file) && scanned.get(file) !== item.calls)
      .map(([file, item]) => ({ file, registered: item.calls, actual: scanned.get(file) }));
    expect(mismatched).toEqual([]);
  });

  it('每個檔各筆涵蓋的呼叫數加總等於該檔呼叫數', () => {
    const mismatched = Object.entries(QUERY_LIMIT_REGISTRY)
      .map(([file, item]) => ({ file, calls: item.calls, sites: item.entries.reduce((sum, e) => sum + sitesOf(e), 0) }))
      .filter((row) => row.calls !== row.sites);
    expect(mismatched).toEqual([]);
  });

  it('每一筆的用途、排序、超量處理、狀態都不空白；known-gap-other 必須有原因', () => {
    const problems: string[] = [];
    for (const [file, item] of Object.entries(QUERY_LIMIT_REGISTRY)) {
      expect(item.entries.length, file).toBeGreaterThan(0);
      item.entries.forEach((entry, index) => {
        const where = `${file}#${index + 1}`;
        if (!entry.purpose?.trim()) problems.push(`${where} purpose`);
        if (!entry.orderBy?.trim()) problems.push(`${where} orderBy`);
        if (!entry.overflow?.trim()) problems.push(`${where} overflow`);
        if (!STATUSES.has(entry.status)) problems.push(`${where} status`);
        if (entry.status === 'known-gap-other' && !entry.reason?.trim()) problems.push(`${where} reason`);
        if (!Number.isInteger(sitesOf(entry)) || sitesOf(entry) < 1) problems.push(`${where} sites`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('依 date 字串排序或篩選的檔，至少一筆註明補零格式依賴', () => {
    const missing: string[] = [];
    for (const file of Object.keys(QUERY_LIMIT_REGISTRY)) {
      const raw = readFileSync(join(ROOT, file), 'utf8');
      const code = stripCommentsAndStrings(raw);
      // 清除後長度不變：在原始碼找 orderBy('date'／where('date'，再看同一位置在清除後是否仍是程式（不在註解裡）。
      const usesDate = [...raw.matchAll(/(orderBy|where)\(\s*['"]date['"]/g)]
        .some((m) => code.startsWith(`${m[1]}(`, m.index));
      if (usesDate && !QUERY_LIMIT_REGISTRY[file]!.entries.some((e) => e.dateFormat === PADDED_DATE_NOTE)) {
        missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });

  it('沒有用別名匯入 limit（別名會讓掃描漏算）', () => {
    const aliased = [...walk(SRC)]
      .map((full) => relative(ROOT, full).split('\\').join('/'))
      .filter(isProductionSource)
      .filter((rel) => /\blimit(?:ToLast)?\s+as\s+[\w$]+/.test(stripCommentsAndStrings(readFileSync(join(ROOT, rel), 'utf8'))));
    expect(aliased).toEqual([]);
  });
});

describe('沒有上限、讀取量會隨歷史變大的查詢（列管）', () => {
  it('檔案還在，欄位不空白，known-gap-other 有原因', () => {
    const problems: string[] = [];
    for (const entry of UNBOUNDED_QUERY_WATCH) {
      if (!existsSync(join(ROOT, entry.file))) problems.push(`${entry.file} missing`);
      if (!entry.purpose.trim()) problems.push(`${entry.file} purpose`);
      if (!STATUSES.has(entry.status)) problems.push(`${entry.file} status`);
      if (entry.status === 'known-gap-other' && !entry.reason?.trim()) problems.push(`${entry.file} reason`);
    }
    expect(problems).toEqual([]);
  });

  it('活動統計依 date 範圍篩選，註明補零格式依賴', () => {
    const rangeStats = UNBOUNDED_QUERY_WATCH.find((e) => e.file === 'src/features/events/data/range-stats.ts');
    expect(rangeStats?.status).toBe('known-gap-batch-E');
    expect(rangeStats?.dateFormat).toBe(PADDED_DATE_NOTE);
  });
});
