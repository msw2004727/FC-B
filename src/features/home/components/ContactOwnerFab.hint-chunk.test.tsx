import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { ContactOwnerFab } from './ContactOwnerFab';

// 不靜態 import './contact-fab-hint'（會先觸發 mock factory，算成已下載）；記錄鍵寫字面值，最後一案核對兩邊一致。
const CONTACT_FAB_HINT_KEY = 'fcb:contact-fab-hinted';
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
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

// 模組 mock 的 factory 只會求值一次，所以「不下載」的案例必須排在第一次真正載入之前。
describe('ContactOwnerFab 提示 chunk 延遲載入', () => {
  it('已提示過就不下載提示 chunk', async () => {
    localStorage.setItem(CONTACT_FAB_HINT_KEY, '1');
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(chunk.loads).toBe(0);
    expect(hint()).toBeNull();
  });

  it('localStorage 讀取丟錯就不下載提示 chunk', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(chunk.loads).toBe(0);
  });

  it('chunk 載入失敗時靜默放棄：不顯示、不記錄、浮球照常可點', async () => {
    chunk.fail = true;
    const onClick = vi.fn();
    render(<ContactOwnerFab onClick={onClick} />);
    await advance(1000);
    expect(chunk.loads).toBe(1);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(localStorage.getItem(CONTACT_FAB_HINT_KEY)).toBeNull();
    const fab = document.querySelector('.contact-owner-fab') as HTMLElement;
    expect(fab.classList.contains('is-shaking')).toBe(false);
    fab.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('主程式的記錄鍵字面值與提示 chunk 的 CONTACT_FAB_HINT_KEY 一致；主程式不靜態載入提示 chunk 與其 CSS', () => {
    expect(read('contact-fab-hint.ts')).toContain(`export const CONTACT_FAB_HINT_KEY = '${CONTACT_FAB_HINT_KEY}';`);
    const fab = read('ContactOwnerFab.tsx');
    expect(fab).toContain(`localStorage.getItem('${CONTACT_FAB_HINT_KEY}')`);
    expect(fab).toContain("import('./contact-fab-hint')");
    expect(fab).not.toMatch(/^import\s+(?!type)[^;]*contact-fab-hint/m);
    expect(read('contact-owner-fab.css')).not.toContain('contact-owner-fab-hint');
  });
});
