import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { ContactOwnerFab } from './ContactOwnerFab';

// 不靜態 import './contact-fab-hint'（會先觸發 mock factory，算成已下載）。
const LEGACY_HINT_KEY = 'fcb:contact-fab-hinted';
const read = (file: string): string => readFileSync(join(process.cwd(), 'src/features/home/components', file), 'utf8');

// 提示 chunk 被下載（動態 import 求值）的次數；fail 為 true 時模擬 chunk 載入失敗。
const chunk = vi.hoisted(() => ({ loads: 0, fail: false }));

vi.mock('./contact-fab-hint', async (importOriginal) => {
  chunk.loads += 1;
  if (chunk.fail) throw new Error('chunk load failed');
  return importOriginal();
});

const hint = (): HTMLElement | null => document.querySelector('.contact-owner-fab-hint');

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await vi.dynamicImportSettled();
  });
}

beforeEach(async () => {
  await setLocale('zh-TW');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  chunk.fail = false;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

// factory 拋錯後這支模組可能被快取成失敗，成功顯示改在 ContactOwnerFab.hint.test.tsx（不 mock chunk）驗證。
// 這裡只留「第一次載入就失敗」與原始碼守門，而且失敗案例必須是這支檔案第一次真正的 dynamic import。
describe('ContactOwnerFab 提示 chunk 延遲載入', () => {
  it('不讀寫 localStorage：兩個檔都沒有記錄鍵，主程式仍動態載入提示 chunk、不靜態載入它與 CSS', () => {
    const hintSrc = read('contact-fab-hint.ts');
    const fab = read('ContactOwnerFab.tsx');
    expect(hintSrc).not.toContain(LEGACY_HINT_KEY);
    expect(fab).not.toContain(LEGACY_HINT_KEY);
    expect(hintSrc).not.toContain('localStorage');
    expect(fab).not.toContain('localStorage');
    expect(fab).toContain("import('./contact-fab-hint')");
    expect(fab).not.toMatch(/^import\s+(?!type\b)[^;]*contact-fab-hint/m);
    expect(read('contact-owner-fab.css')).not.toContain('contact-owner-fab-hint');
  });

  it('chunk 載入失敗時靜默放棄：不顯示、不寫記錄鍵、浮球照常可點', async () => {
    chunk.fail = true;
    const onClick = vi.fn();
    render(<ContactOwnerFab onClick={onClick} />);
    await advance(1000);
    expect(chunk.loads).toBe(1);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
    const fab = document.querySelector('.contact-owner-fab') as HTMLElement;
    expect(fab.classList.contains('is-shaking')).toBe(false);
    fab.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
