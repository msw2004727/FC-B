import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { ContactOwnerFab } from './ContactOwnerFab';
import { CONTACT_FAB_HINT_KEY } from './use-contact-fab-hint';

const HINT = '有問題？點這裡聯繫站長';
const fabCss = readFileSync(join(process.cwd(), 'src/features/home/components/contact-owner-fab.css'), 'utf8');

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

describe('ContactOwnerFab 首次提示', () => {
  it('首次進首頁約 1 秒後抖動並顯示泡泡，0.6 秒後停抖、4 秒後泡泡消失', async () => {
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(999);
    expect(hint()).toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
    await advance(1);
    expect(hint()?.textContent).toBe(HINT);
    expect(hint()?.getAttribute('role')).toBe('status');
    expect(fab().classList.contains('is-shaking')).toBe(true);
    expect(localStorage.getItem(CONTACT_FAB_HINT_KEY)).toBe('1');
    await advance(600);
    expect(fab().classList.contains('is-shaking')).toBe(false);
    expect(hint()).not.toBeNull();
    await advance(3399);
    expect(hint()).not.toBeNull();
    await advance(1);
    expect(hint()).toBeNull();
  });

  it('同一台裝置第二次不再提示', async () => {
    const first = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(hint()).not.toBeNull();
    first.unmount();
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
  });

  it('localStorage 讀取丟錯時視為已提示過，不顯示', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(hint()).toBeNull();
    expect(fab().classList.contains('is-shaking')).toBe(false);
  });

  it('localStorage 寫入丟錯時也不顯示', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(6000);
    expect(hint()).toBeNull();
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
    expect(localStorage.getItem(CONTACT_FAB_HINT_KEY)).toBeNull();
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
    expect(localStorage.getItem(CONTACT_FAB_HINT_KEY)).toBeNull();
  });

  it('顯示中 unmount 也清掉停抖與消失計時器', async () => {
    const view = render(<ContactOwnerFab onClick={() => undefined} />);
    await advance(1000);
    expect(hint()).not.toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CSS：reduced motion 關掉抖動與泡泡進場動畫；泡泡單行、在浮球上方', () => {
    expect(fabCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.contact-owner-fab\.is-shaking,\s*\.contact-owner-fab-hint\s*\{\s*animation:\s*none/);
    expect(fabCss).toMatch(/\.contact-owner-fab-hint\s*\{[^}]*white-space:\s*nowrap/);
    expect(fabCss).toMatch(/\.contact-owner-fab-hint\s*\{[^}]*\+\s*80px\)/);
  });
});
