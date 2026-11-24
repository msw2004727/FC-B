// 建立賽事反光（create-sheen.ts）：畫面內且分頁在前景才跑、清理不殘留、減少動態不掛、外觀數字照預覽第 1 種。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREATE_SHEEN_CSS, CREATE_SHEEN_STYLE_ID, SHEEN_CYCLE_SEC, startCreateSheen } from './create-sheen';

function slot(): HTMLElement {
  const btn = document.createElement('button');
  btn.innerHTML = '<span>建立賽事</span><i class="cpl-sheen" style="position:absolute"></i>';
  document.body.appendChild(btn);
  return btn.querySelector<HTMLElement>('.cpl-sheen')!;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById(CREATE_SHEEN_STYLE_ID)?.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'hidden');
});

describe('建立賽事反光（站長 11-24：每 3 秒一次）', () => {
  it('外觀照預覽第 1 種：105° 斜帶、白 .65、每 3 秒、最後 30%（約 0.9 秒）掃過；只用 transform 位移', () => {
    expect(SHEEN_CYCLE_SEC).toBe(3);
    expect(CREATE_SHEEN_CSS).toContain('linear-gradient(105deg,transparent 30%,rgba(255,255,255,.65) 50%,transparent 70%)');
    expect(CREATE_SHEEN_CSS).toContain('animation:cplSheen 3s ease-in-out infinite');
    expect(CREATE_SHEEN_CSS).toContain('@keyframes cplSheen{0%,70%{transform:translateX(-66.667%)}100%{transform:translateX(0)}}');
    expect(CREATE_SHEEN_CSS).not.toMatch(/background-position|box-shadow/);
  });

  it('啟動後加 is-on 與樣式；分頁進背景就停、回前景再跑；清理拿掉 is-on 與樣式，之後切分頁也不再加回', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const el = slot();
    const stop = startCreateSheen(el);
    expect(el.classList.contains('is-on')).toBe(true);
    expect(document.getElementById(CREATE_SHEEN_STYLE_ID)?.textContent).toBe(CREATE_SHEEN_CSS);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(el.classList.contains('is-on')).toBe(false);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(el.classList.contains('is-on')).toBe(true);
    stop();
    expect(el.classList.contains('is-on')).toBe(false);
    expect(document.getElementById(CREATE_SHEEN_STYLE_ID)).toBeNull();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(el.classList.contains('is-on')).toBe(false);
  });

  it('捲出畫面（IntersectionObserver 回報不在畫面內）就停', () => {
    let cb: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(fn: typeof cb) { cb = fn; }
      observe() {}
      disconnect() {}
    });
    const el = slot();
    const stop = startCreateSheen(el);
    expect(el.classList.contains('is-on')).toBe(false);
    cb!([{ isIntersecting: true }]);
    expect(el.classList.contains('is-on')).toBe(true);
    cb!([{ isIntersecting: false }]);
    expect(el.classList.contains('is-on')).toBe(false);
    stop();
  });

  it('減少動態：不加 is-on、不放樣式', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const el = slot();
    const stop = startCreateSheen(el);
    expect(el.classList.contains('is-on')).toBe(false);
    expect(document.getElementById(CREATE_SHEEN_STYLE_ID)).toBeNull();
    stop();
  });
});
