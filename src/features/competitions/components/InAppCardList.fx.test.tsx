// 招募中光軌的整合清理（審查 31642f7e P2-1、P2-2）：InAppCardList 的動態載入 effect × recruit-orbit 的監聽與實例 style。
// 用假的 IntersectionObserver（可手動送回呼、留著舊實例送「已排隊的舊回呼」）、假的 ResizeObserver（計 observe／disconnect）、
// 計 visibilitychange 掛拆次數，鎖住：同組成重畫不重綁、組成改變整組拆再重掛、import 完成前卸載無殘留、快速連換只留一組、
// 背景↔前景循環不累積、名額捲出釋放補位、清理後的舊回呼不重掛。
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InAppListCard } from '../data/list-cards';
import { makeCompetitionsT } from '../i18n';
import { InAppCardList } from './InAppCardList';
import { RECRUIT_FX_STYLE_ID } from './recruit-orbit';

type Entry = { target: Element; isIntersecting: boolean };

class FakeIO {
  static all: FakeIO[] = [];
  readonly targets: Element[] = [];
  disconnected = false;
  constructor(readonly cb: (entries: Entry[]) => void) {
    FakeIO.all.push(this);
  }
  observe(el: Element): void {
    this.targets.push(el);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  /** 把觀察中的前 n 個 slot 標成在畫面內。 */
  show(n: number): void {
    this.cb(this.targets.map((target, i) => ({ target, isIntersecting: i < n })));
  }
}

const ro = { observe: 0, disconnect: 0 };
class FakeRO {
  observe(): void {
    ro.observe += 1;
  }
  disconnect(): void {
    ro.disconnect += 1;
  }
}

const vis = { add: 0, remove: 0 };
const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);

function card(cid: string, patch: Partial<InAppListCard> = {}): InAppListCard {
  return {
    cid, name: cid, category: 'cup', phase: 'recruit', date: '', venue: '', firstMatchAt: 1,
    line: { kind: 'deadline', date: '12/01 23:59' }, mine: false, ended: false, statusMark: null, cover: '', ...patch,
  };
}

const ct = makeCompetitionsT({});
const list = (cards: InAppListCard[]) => (
  <InAppCardList cards={cards} ct={ct} status="open" onlyMine={false} showCreate={false}
    onStatus={() => {}} onOnlyMine={() => {}} onCreate={() => {}} onOpen={() => {}} />
);

const orbits = () => document.querySelectorAll('.cpl-fx-slot > .orbit').length;
const instanceStyles = () => document.querySelectorAll('style[data-cpl-fx-instance]').length;
const staticStyles = () => document.querySelectorAll(`#${RECRUIT_FX_STYLE_ID}`).length;
const liveIO = () => FakeIO.all.filter((io) => !io.disconnected);
const roActive = () => ro.observe - ro.disconnect;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
/** 等動態載入完成、IntersectionObserver 建好。 */
async function ready(count = 1): Promise<FakeIO> {
  await waitFor(() => expect(liveIO()).toHaveLength(count));
  return liveIO()[liveIO().length - 1]!;
}

beforeEach(() => {
  FakeIO.all = [];
  ro.observe = 0;
  ro.disconnect = 0;
  vis.add = 0;
  vis.remove = 0;
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.spyOn(document, 'addEventListener').mockImplementation((type: string, ...rest: unknown[]) => {
    if (type === 'visibilitychange') vis.add += 1;
    return (origAdd as (t: string, ...r: unknown[]) => void)(type, ...rest);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type: string, ...rest: unknown[]) => {
    if (type === 'visibilitychange') vis.remove += 1;
    return (origRemove as (t: string, ...r: unknown[]) => void)(type, ...rest);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'hidden');
});

/** 卸載後一切歸零。 */
function expectNoResidue(): void {
  expect(orbits()).toBe(0);
  expect(instanceStyles()).toBe(0);
  expect(staticStyles()).toBe(0);
  expect(roActive()).toBe(0);
  expect(liveIO()).toHaveLength(0);
  expect(vis.add).toBe(vis.remove);
}

describe('招募中光軌整合清理', () => {
  it('同一組招募中卡重畫（新陣列、同 cid）：沿用不重綁', async () => {
    const view = render(list([card('a'), card('b')]));
    const io = await ready();
    act(() => io.show(2));
    expect(orbits()).toBe(2);
    expect(roActive()).toBe(2);
    view.rerender(list([card('a'), card('b')]));
    await flush();
    expect(FakeIO.all).toHaveLength(1);
    expect(ro.observe).toBe(2);
    expect(vis.add).toBe(1);
    view.unmount();
    expectNoResidue();
  });

  it.each([
    ['快照換讀回後重排', [card('b'), card('a')]],
    ['篩選切換（少一張、多一張）', [card('a'), card('c')]],
    ['其中一張變延期（不再有光軌）', [card('a'), card('b', { statusMark: 'postponed' })]],
  ])('%s：整組拆再重掛；實例 style 數＝光軌數 ≤ 3、共用靜態 style 恰 1', async (_label, next) => {
    const view = render(list([card('a'), card('b')]));
    const first = await ready();
    act(() => first.show(2));
    expect(orbits()).toBe(2);
    view.rerender(list(next));
    const second = await ready();
    expect(first.disconnected).toBe(true);
    expect(second).not.toBe(first);
    act(() => second.show(9));
    const slots = document.querySelectorAll('.cpl-fx-slot').length;
    expect(orbits()).toBe(Math.min(slots, 3));
    expect(instanceStyles()).toBe(orbits());
    expect(roActive()).toBe(orbits());
    expect(staticStyles()).toBe(1);
    expect(vis.add - vis.remove).toBe(1);
    view.unmount();
    expectNoResidue();
  });

  it('即將開放（站長 11-22）：不放光軌掛點、不載入光軌；膠囊與數字格換成即將開放、開放報名，帶 data-soon', async () => {
    const soon = card('s', { soon: true, line: { kind: 'opens', date: '12/01 10:00' } });
    const view = render(list([soon]));
    await flush();
    expect(document.querySelector('.cpl-fx-slot')).toBeNull();
    expect(staticStyles()).toBe(0);
    const el = document.querySelector('[data-cid="s"]')!;
    expect(el.hasAttribute('data-soon')).toBe(true);
    expect(el.querySelector('.d2-sb__st')?.textContent).toBe(ct('statusSoon'));
    expect(el.textContent).toContain(ct('boardOpens'));
    expect(el.textContent).toContain('12/01 10:00');
    // 延期蓋過即將開放：不帶 data-soon，膠囊寫延期
    view.rerender(list([card('s', { soon: true, statusMark: 'postponed', line: { kind: 'opens', date: '12/01 10:00' } })]));
    const pp = document.querySelector('[data-cid="s"]')!;
    expect(pp.hasAttribute('data-soon')).toBe(false);
    expect(pp.querySelector('.d2-sb__st')?.textContent).toBe(ct('compPostponed'));
    view.unmount();
  });

  it('清理後才收到已排隊的舊 IntersectionObserver 回呼：不在舊 slot 重掛（審查 P2-1）', async () => {
    const view = render(list([card('a'), card('b')]));
    const first = await ready();
    act(() => first.show(2));
    view.rerender(list([card('a'), card('c')]));
    const second = await ready();
    act(() => second.show(2));
    // 舊實例已 disconnect，但瀏覽器早已排好的回呼還是送進來（slot 節點沿用，同 cid 'a'）
    act(() => first.show(2));
    expect(orbits()).toBe(2);
    expect(instanceStyles()).toBe(2);
    expect(roActive()).toBe(2);
    expect(document.querySelectorAll('[data-cid="a"] .cpl-fx-slot > .orbit')).toHaveLength(1);
    view.unmount();
    expectNoResidue();
  });

  it('動態 import 完成前就卸載：之後不掛任何東西', async () => {
    const view = render(list([card('a'), card('b')]));
    view.unmount();
    await flush();
    await flush();
    expect(FakeIO.all).toHaveLength(0);
    expectNoResidue();
  });

  it('快速連換三組（import 都還沒回來）：最後只留一組', async () => {
    const view = render(list([card('a')]));
    view.rerender(list([card('a'), card('b')]));
    view.rerender(list([card('c'), card('d'), card('e')]));
    const io = await ready();
    await flush();
    expect(liveIO()).toHaveLength(1);
    expect(io.targets).toHaveLength(3);
    act(() => io.show(3));
    expect(orbits()).toBe(3);
    expect(vis.add - vis.remove).toBe(1);
    view.unmount();
    expectNoResidue();
  });

  it('背景↔前景循環 5 次：光軌、實例 style、ResizeObserver 都不累積', async () => {
    const view = render(list([card('a'), card('b')]));
    const io = await ready();
    act(() => io.show(2));
    for (let i = 0; i < 5; i++) {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(orbits()).toBe(0);
      expect(roActive()).toBe(0);
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(orbits()).toBe(2);
      expect(instanceStyles()).toBe(2);
      expect(roActive()).toBe(2);
    }
    expect(vis.add).toBe(1);
    view.unmount();
    expectNoResidue();
  });

  it('名額 3 張：捲出畫面的釋放、下一張補位，ResizeObserver 跟著拆綁', async () => {
    const view = render(list(['a', 'b', 'c', 'd', 'e'].map((cid) => card(cid))));
    const io = await ready();
    act(() => io.show(4));
    expect(orbits()).toBe(3);
    expect(document.querySelector('[data-cid="d"] .cpl-fx-slot > .orbit')).toBeNull();
    act(() => io.cb([{ target: io.targets[0]!, isIntersecting: false }]));
    expect(document.querySelector('[data-cid="a"] .cpl-fx-slot > .orbit')).toBeNull();
    expect(document.querySelector('[data-cid="d"] .cpl-fx-slot > .orbit')).not.toBeNull();
    expect(orbits()).toBe(3);
    expect(roActive()).toBe(3);
    view.unmount();
    expectNoResidue();
  });
});
