import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { ContactOwnerFab } from './ContactOwnerFab';

const HINT = '有問題？點這裡聯繫站長';
/** 舊的「每台裝置一次」記錄鍵。提示不再讀、不再寫；殘留值留著不管。 */
const LEGACY_HINT_KEY = 'fcb:contact-fab-hinted';
const fabCss = readFileSync(join(process.cwd(), 'src/features/home/components/contact-fab-hint.css'), 'utf8');

function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

const fab = (): HTMLElement => document.querySelector('.contact-owner-fab') as HTMLElement;
const hint = (): HTMLElement | null => document.querySelector('.contact-owner-fab-hint');

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    // 提示 chunk 是動態 import：等它載完、掛上（不推進時間）
    await vi.dynamicImportSettled();
  });
}

beforeEach(async () => {
  await setLocale('zh-TW');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  setReducedMotion(false);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ContactOwnerFab 每次回到首頁提示', () => {
  it('進首頁約 1 秒後抖動並顯示泡泡，4.8 秒後停抖、6 秒後泡泡消失，且不寫記錄鍵', async () => {
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(999);
    expect(hint()).toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
    await advance(1);
    expect(hint()?.textContent).toBe(HINT);
    expect(hint()?.getAttribute('role')).toBe('status');
    expect(fab().classList.contains('is-shaking')).toBe(true);
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
    await advance(4799);
    expect(fab().classList.contains('is-shaking')).toBe(true);
    expect(hint()).not.toBeNull();
    await advance(1);
    expect(fab().classList.contains('is-shaking')).toBe(false);
    expect(hint()).not.toBeNull();
    await advance(1199);
    expect(hint()).not.toBeNull();
    await advance(1);
    expect(hint()).toBeNull();
  });

  it('離開首頁再回來會再提示一次', async () => {
    const first = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(hint()?.textContent).toBe(HINT);
    first.unmount();
    expect(hint()).toBeNull();
    window.history.replaceState(null, '', '/activities');
    window.history.replaceState(null, '', '/');
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(999);
    expect(hint()).toBeNull();
    await advance(1);
    expect(hint()?.textContent).toBe(HINT);
    expect(fab().classList.contains('is-shaking')).toBe(true);
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
  });

  it('不讀寫 localStorage 也能提示：讀寫丟錯或殘留舊鍵都不影響，且不再寫入記錄鍵', async () => {
    localStorage.setItem(LEGACY_HINT_KEY, '1');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(hint()?.textContent).toBe(HINT);
    expect(fab().classList.contains('is-shaking')).toBe(true);
    expect(getItem.mock.calls.some((args) => args[0] === LEGACY_HINT_KEY)).toBe(false);
    expect(setItem.mock.calls.some((args) => args[0] === LEGACY_HINT_KEY)).toBe(false);
    getItem.mockRestore();
    setItem.mockRestore();
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBe('1');
  });

  it('reduced motion 只顯示泡泡，不抖動', async () => {
    setReducedMotion(true);
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(hint()).not.toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
  });

  it('點泡泡以外的地方關閉泡泡，且該次點擊照常送達', async () => {
    const outside = document.createElement('button');
    const onOutside = vi.fn();
    outside.addEventListener('click', onOutside);
    document.body.appendChild(outside);
    const onClick = vi.fn();
    render(<ContactOwnerFab onClick={onClick} />);
    await advance(1000);
    expect(hint()).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(outside);
      fireEvent.click(outside);
    });
    expect(hint()).toBeNull();
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    outside.remove();
  });

  it('泡泡顯示中（1 秒後再過 1 秒）在泡泡以外 pointerdown，立刻移除泡泡、停止抖動、計時器為 0', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    await advance(1000);
    expect(hint()).not.toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(outside);
    });
    expect(hint()).toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    outside.remove();
  });

  it('點泡泡等同點浮球：開啟聯繫站長並關閉泡泡', async () => {
    const onClick = vi.fn();
    render(<ContactOwnerFab onClick={onClick} />);
    await advance(1000);
    const bubble = hint() as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(bubble);
      fireEvent.click(bubble);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();
  });

  it('1 秒內先點浮球就不再跳提示', async () => {
    const onClick = vi.fn();
    render(<ContactOwnerFab onClick={onClick} />);
    await advance(500);
    await act(async () => {
      fireEvent.click(fab());
    });
    await advance(6000);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();
  });

  it('不在首頁就不顯示，也不記錄已提示', async () => {
    window.history.replaceState(null, '', '/activities');
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
  });

  it('同一次停留期間重繪不重複觸發', async () => {
    const view = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(500);
    view.rerender(<ContactOwnerFab onClick={() => undefined} />);
    await advance(500);
    expect(document.querySelectorAll('.contact-owner-fab-hint')).toHaveLength(1);
    view.rerender(<ContactOwnerFab onClick={() => undefined} />);
    expect(document.querySelectorAll('.contact-owner-fab-hint')).toHaveLength(1);
    await advance(6000);
    expect(hint()).toBeNull();
    view.rerender(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount 時清掉計時器，不再觸發也不記錄', async () => {
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    const view = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(500);
    view.unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
  });

  it('顯示中 unmount 也清掉停抖與消失計時器', async () => {
    const view = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(hint()).not.toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // 1 秒到、提示 chunk 還在下載時，點浮球或卸下都不能再顯示泡泡。
  it('提示 chunk 下載期間點了浮球，下載完不顯示泡泡、不記錄', async () => {
    const onClick = vi.fn();
    render(<ContactOwnerFab onClick={onClick} />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      fireEvent.click(fab());
      await vi.dynamicImportSettled();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
  });

  it('提示 chunk 下載期間卸下又重新掛上，只由新的浮球顯示一次泡泡，卸下時收乾淨', async () => {
    const first = render(<ContactOwnerFab onClick={() => undefined} />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      first.unmount();
      await vi.dynamicImportSettled();
    });
    expect(hint()).toBeNull();
    expect(localStorage.getItem(LEGACY_HINT_KEY)).toBeNull();
    const second = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(document.querySelectorAll('.contact-owner-fab-hint')).toHaveLength(1);
    second.unmount();
    expect(hint()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CSS：兩組 keyframes 各自每輪 -14deg／14deg 各 8 個百分比且去掉名稱後相同；is-shaking 含 1.6s、第二段延遲 3.2s；reduced motion 仍 none；泡泡單行、在浮球上方', () => {
    const keyframeBody = (name: string): string => {
      const marker = `@keyframes ${name} {`;
      const start = fabCss.indexOf(marker);
      expect(start).toBeGreaterThanOrEqual(0);
      let depth = 0;
      for (let i = start + marker.length - 1; i < fabCss.length; i += 1) {
        if (fabCss[i] === '{') depth += 1;
        else if (fabCss[i] === '}') {
          depth -= 1;
          if (depth === 0) return fabCss.slice(start + marker.length, i);
        }
      }
      throw new Error(`unclosed @keyframes ${name}`);
    };
    // 「那行」：只數含這個 rotate() 的那一行上的百分比，避免把 0%/100% 或其他角度算進去。
    const rotateLinePercents = (body: string, degrees: string): string[] => {
      const needle = `rotate(${degrees})`;
      const lines = body.split('\n').filter((line) => line.includes(needle));
      expect(lines, needle).toHaveLength(1);
      return lines[0].match(/\d+(?:\.\d+)?%/g) ?? [];
    };
    expect(fabCss.match(/@keyframes\s+contact-owner-fab-shake(?:-2)?\s*\{/g)).toHaveLength(2);
    const round = keyframeBody('contact-owner-fab-shake');
    const round2 = keyframeBody('contact-owner-fab-shake-2');
    expect(rotateLinePercents(round, '-14deg')).toHaveLength(8);
    expect(rotateLinePercents(round, '14deg')).toHaveLength(8);
    expect(rotateLinePercents(round2, '-14deg')).toHaveLength(8);
    expect(rotateLinePercents(round2, '14deg')).toHaveLength(8);
    expect(round).toBe(round2);
    expect(fabCss).toMatch(
      /\.contact-owner-fab\.is-shaking\s*\{[^}]*animation:\s*contact-owner-fab-shake\s+1\.6s\s+ease-in-out\s+0s\s*,\s*contact-owner-fab-shake-2\s+1\.6s\s+ease-in-out\s+3\.2s/,
    );
    expect(fabCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.contact-owner-fab\.is-shaking,\s*\.contact-owner-fab-hint\s*\{\s*animation:\s*none/);
    expect(fabCss).toMatch(/\.contact-owner-fab-hint\s*\{[^}]*white-space:\s*nowrap/);
    expect(fabCss).toMatch(/\.contact-owner-fab-hint\s*\{[^}]*\+\s*80px\)/);
  });
});
