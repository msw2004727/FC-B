import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/**
 * 允許 target="_blank" 或 window.open(..., '_blank') 的檔案。值是原因。
 */
const BLANK_ALLOWLIST: Record<string, string> = {
  'src/features/profile/components/legacy/LegacyFirstLoginModal.tsx':
    '首次登入表單的條款／隱私維持另開：同分頁會丟掉尚未送出的表單。這是站內頁，不用 openExternal。',
  'src/features/inbox/components/pm-message-format.tsx':
    '站內信是使用者自填的任意網址。window.open 在部分瀏覽器回傳 null 時清不掉 opener，反向分頁劫持由對方控制，所以保留 rel="noopener noreferrer" 的另開。',
  'src/features/events/data/event-share.ts':
    'line.me 分享網址維持原行為，不是一般外連。Mini App 的 Flex 分享走既有 shareTargetPicker，不另寫流程。',
  'src/features/events/data/line-notify-bind.ts':
    'LINE 加好友網址維持原行為，不是一般外連。',
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
  return base.includes('.test.') || base === 'open-external.ts';
}

function blankHits(source: string): number[] {
  const lines = source.split('\n');
  const hits = new Set<number>();
  lines.forEach((line, index) => {
    if (/target\s*=\s*["']_blank["']/.test(line) || /target\s*=\s*\{\s*["']_blank["']\s*\}/.test(line)) {
      hits.add(index + 1);
    }
  });
  const pattern = /window\.open\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const slice = source.slice(match.index, match.index + 500);
    const close = slice.indexOf(')');
    const call = close === -1 ? slice : slice.slice(0, close + 1);
    if (call.includes("'_blank'") || call.includes('"_blank"')) {
      hits.add(source.slice(0, match.index).split('\n').length);
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

  it('src 除白名單外不得 target=_blank 或 window.open _blank', () => {
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
