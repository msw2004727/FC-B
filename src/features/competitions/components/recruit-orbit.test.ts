// 招募中卡光軌（recruit-orbit.ts）：最多 3 張、分頁在背景就停、捲出畫面就停、減少動態只留靜態星芒、清理不殘留。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ACTIVE, RECRUIT_FX_CSS, RECRUIT_FX_STYLE_ID, startRecruitFx } from './recruit-orbit';

function rootWith(n: number): HTMLElement {
  const root = document.createElement('div');
  for (let i = 0; i < n; i++) {
    const link = document.createElement('a');
    link.innerHTML = '<i class="cpl-fx-slot" aria-hidden="true"></i>';
    root.appendChild(link);
  }
  document.body.appendChild(root);
  return root;
}

const running = (root: HTMLElement) => root.querySelectorAll('.cpl-fx-slot > .orbit').length;
const instanceStyles = () => document.querySelectorAll('style[data-cpl-fx-instance]').length;

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'hidden');
});

describe('招募中光軌', () => {
  it('沒有 IntersectionObserver 時當作前幾張在畫面內：最多 3 張有光軌與星芒，其餘只有邊框', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = rootWith(5);
    const stop = startRecruitFx(root);
    expect(MAX_ACTIVE).toBe(3);
    expect(running(root)).toBe(3);
    expect(root.querySelectorAll('.cpl-fx-slot > .burst')).toHaveLength(3);
    expect(instanceStyles()).toBe(3);
    // keyframes 選擇器指向各自的 slot（重用 core/update-prompt-fx 的 bindOrbitLayout／buildKeyframes）
    const first = root.querySelector<HTMLElement>('.cpl-fx-slot')!;
    expect(document.querySelector('style[data-cpl-fx-instance]')?.textContent).toContain(`.cpl-fx-slot[data-fx-id="${first.dataset.fxId}"] .orbit .tail`);
    stop();
  });

  it('清理：拿掉所有光軌、星芒、實例 style、靜態 style；之後切分頁也不會再掛回（監聽已拆）', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = rootWith(2);
    const stop = startRecruitFx(root);
    expect(document.getElementById(RECRUIT_FX_STYLE_ID)).not.toBeNull();
    stop();
    expect(root.querySelectorAll('.cpl-fx-slot > *')).toHaveLength(0);
    expect(instanceStyles()).toBe(0);
    expect(document.getElementById(RECRUIT_FX_STYLE_ID)).toBeNull();
    expect([...root.querySelectorAll('.cpl-fx-slot')].some((el) => el.hasAttribute('data-fx-id'))).toBe(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(running(root)).toBe(0);
    stop();
  });

  it('分頁進背景（document.hidden）全部停，回到前景再掛回', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = rootWith(2);
    const stop = startRecruitFx(root);
    expect(running(root)).toBe(2);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(running(root)).toBe(0);
    expect(instanceStyles()).toBe(0);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(running(root)).toBe(2);
    stop();
  });

  it('只對畫面內的卡啟動：捲出畫面就停，捲進來的補上（仍不超過 3 張）', () => {
    let cb: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => {};
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(fn: typeof cb) { cb = fn; }
      observe(el: Element) { observed.push(el); }
      disconnect() { disconnect(); }
    });
    const root = rootWith(5);
    const stop = startRecruitFx(root);
    expect(running(root)).toBe(0);
    const slots = [...root.querySelectorAll('.cpl-fx-slot')];
    cb(slots.map((target, i) => ({ target, isIntersecting: i < 4 })));
    expect(running(root)).toBe(3);
    expect(slots[3]!.querySelector('.orbit')).toBeNull();
    cb([{ target: slots[0]!, isIntersecting: false }]);
    expect(slots[0]!.querySelector('.orbit')).toBeNull();
    expect(slots[3]!.querySelector('.orbit')).not.toBeNull();
    expect(running(root)).toBe(3);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(running(root)).toBe(0);
  });

  it('減少動態（prefers-reduced-motion）：不畫光軌、不產生 keyframes，只留一顆靜態星芒', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const root = rootWith(4);
    const stop = startRecruitFx(root);
    expect(running(root)).toBe(0);
    expect(instanceStyles()).toBe(0);
    expect(root.querySelectorAll('.cpl-fx-slot.is-still > .burst')).toHaveLength(3);
    stop();
    expect(root.querySelectorAll('.cpl-fx-slot > *')).toHaveLength(0);
  });
});

// 樣式字串不經 Vite 降級；iOS 14.0 不認 inset，一律寫四邊（顧問 §3.580）
it('光軌樣式不用 inset 簡寫', () => {
  expect(RECRUIT_FX_CSS).not.toMatch(/(^|[;{])inset\s*:/);
  expect(RECRUIT_FX_CSS).toContain('.cpl-fx-slot{position:absolute;top:0;right:0;bottom:0;left:0;');
});
