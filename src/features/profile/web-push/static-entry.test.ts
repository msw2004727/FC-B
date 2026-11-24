// 設計書 §3.3 第 4 點：推播程式不得被靜態拉進首頁主程式或個人頁以外的分塊。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/locales';

const SRC = resolve(__dirname, '../../..');
const PROFILE = resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('I 字典與入口靜態檢查', () => {
  it('個人頁 eager 字典（locales/）不含 webPush；七語 locales-lazy 都有 webPush', () => {
    for (const locale of LOCALES) {
      const eager = readFileSync(join(PROFILE, 'locales', `${locale}.json`), 'utf8');
      expect(eager, locale).not.toContain('webPush');
      const lazy = JSON.parse(readFileSync(join(PROFILE, 'locales-lazy', `${locale}.json`), 'utf8')) as { webPush: Record<string, string> };
      expect(Object.keys(lazy.webPush).length, locale).toBe(13);
    }
  });

  it('web-push/ 以外只有 WebPushSlot 靜態 import（只取 env.ts）；側邊選單與右上角只用 import()', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (rel.startsWith('features/profile/web-push/')) continue;
      // src/dev 是本機截圖台，不進正式打包。
      if (rel.startsWith('dev/')) continue;
      const text = readFileSync(file, 'utf8');
      const statics = [...text.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]*web-push\/[^'"]*)['"]/gm)].map((m) => m[1]!);
      for (const spec of statics) {
        if (rel === 'features/profile/components/legacy/WebPushSlot.tsx' && spec === '../../web-push/env') continue;
        offenders.push(`${rel} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('推播列與開機模組不 import env.ts（避免個人頁分塊多出匯出、改到入口）', () => {
    for (const name of ['WebPushRow.tsx', 'boot.ts', 'flows.ts']) {
      const text = readFileSync(join(__dirname, name), 'utf8');
      // 只允許 import type（編譯後消失）。
      expect(text, name).not.toMatch(/^import (?!type )[^;]*from '\.\/env'/m);
    }
  });

  it('沒有改動 Callable 登錄（CALLABLES 不含推播）', () => {
    const text = readFileSync(join(SRC, 'data/contract/callables.ts'), 'utf8');
    expect(text).not.toContain('WebPush');
  });
});

describe('側邊選單的推播鍵名', () => {
  it('SideDrawer、TopBar 寫死的鍵名與 store.ts 的 WEB_PUSH_STORE_KEY 一致', () => {
    const drawer = readFileSync(join(SRC, 'ui/SideDrawer.tsx'), 'utf8');
    const store = readFileSync(join(__dirname, 'store.ts'), 'utf8');
    const key = /WEB_PUSH_STORE_KEY = '([^']+)'/;
    const expected = key.exec(store)?.[1];
    expect(expected).toBe('fcb:webpush:v1');
    expect(key.exec(drawer)?.[1]).toBe(expected);
    expect(readFileSync(join(SRC, 'ui/TopBar.tsx'), 'utf8')).toContain(`localStorage.getItem('${expected}')`);
  });
});
