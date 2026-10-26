import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useLayoutEffect } from 'preact/hooks';
import type { BannerDoc } from '../../data/banners';
import { HomeBannerCarousel } from './HomeBannerCarousel';

// T-042 橫幅圖「畫面」回到原本（a924c7b）的 slide inline background-image，不用 <img> 當畫面，載入失敗也維持原本畫面。
// - 圖片由 `new Image()` 載（先載到才設背景圖）；第一張一掛載就載，其餘只在目前這張有結果之後才載下一張；
// - 提早高優先權下載：第一張動態加 <link rel="preload" as="image" fetchpriority="high">，href 與背景圖用同一個網址字串；
// - 成功／失敗／逾時分開：成功與逾時設背景圖、失敗不設（壞網址的背景圖本來就什麼都不畫，只剩暗色遮罩），三者都取消壓暗；
// - 載入工作有生命週期（退修 8）：卸載、網址離開清單時作廢，之後才回來的 onload／onerror／decode／逾時都不得寫共用紀錄或本地狀態；
//   共用紀錄命中時要把本地狀態同步成 loaded。
// 模組內有「已載入成功」的快取（切頁回來略過淡入、不重載），所以每個案例用不同的圖片網址。

const noop = (): void => undefined;
const props = { onOpenNearbyMap: noop, onOpenSearchModal: noop, onOpenCreateEvent: noop, canCreate: false };

let seq = 0;
function urls(count: number): string[] {
  seq += 1;
  return Array.from({ length: count }, (_, i) => `https://img.example/${seq}/${i + 1}.webp`);
}

function banner(id: string, image: string, extra: Partial<BannerDoc> = {}): BannerDoc {
  return { id, _docId: id, status: 'active', title: id, image, ...extra };
}

function carousel(banners: BannerDoc[]): preact.JSX.Element {
  return <HomeBannerCarousel banners={banners} {...props} />;
}

function renderCarousel(banners: BannerDoc[]): { container: HTMLElement; unmount: () => void; rerender: (b: BannerDoc[]) => void } {
  const view = render(carousel(banners));
  return {
    container: view.container as HTMLElement,
    unmount: view.unmount,
    rerender: (next) => view.rerender(carousel(next)),
  };
}

function slides(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('#banner-track .banner-slide'));
}
const stateOf = (slide: HTMLElement | undefined): string | null => (slide as HTMLElement).getAttribute('data-banner-load-state');
/** jsdom 讀回的 style 是序列化後的樣子（多空白、center → center center），所以期望值也先經過同一個序列化再比。 */
function norm(css: string): string {
  const el = document.createElement('div');
  el.style.cssText = css;
  return el.getAttribute('style') ?? '';
}
const bgOf = (u: string): string => norm(`background-image:url("${u}");background-size:cover;background-position:center;`);
const preloadLinks = (): HTMLLinkElement[] =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'));

/** 替身：每個 `new Image()` 都記下網址與回呼；測試用 load()／fail() 手動結算（回呼即使在作廢之後仍保留，用來模擬「晚到的事件」）。 */
const requested: string[] = [];
const instances: FakeImage[] = [];
const decodeCalls: Array<{ url: string; resolve: () => void; reject: (e?: unknown) => void }> = [];
class FakeImage {
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url = '';
  set src(value: string) {
    this.url = value;
    requested.push(value);
    instances.push(this);
  }
}
function installDecode(): void {
  (FakeImage.prototype as unknown as { decode: () => Promise<void> }).decode = function decode(this: FakeImage): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      decodeCalls.push({ url: this.url, resolve, reject });
    });
  };
}
const imagesFor = (u: string): FakeImage[] => instances.filter((i) => i.url === u);
async function load(u: string, n = 0): Promise<void> {
  await act(async () => {
    (imagesFor(u)[n] as FakeImage).onload?.();
  });
}
async function fail(u: string, n = 0): Promise<void> {
  await act(async () => {
    (imagesFor(u)[n] as FakeImage).onerror?.();
  });
}
/** 完成訊號：讓目前已排入的 Promise 工作（含 decode 的 then 與 Preact 的重繪）跑完——只保證這一刻之前排入的，不含之後才排入的。 */
const flush = (): Promise<void> => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number): Promise<void> => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  requested.length = 0;
  instances.length = 0;
  decodeCalls.length = 0;
  vi.stubGlobal('Image', FakeImage);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (FakeImage.prototype as { decode?: unknown }).decode;
  for (const link of preloadLinks()) link.remove();
});

describe('HomeBannerCarousel 載入策略', () => {
  it('第一張一掛載就載、其餘不載；目前這張載好後只載下一張，第三張不動；重新渲染不重複載', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);

    await advance(1000);
    expect(requested).toEqual([u1]);

    await load(u1);
    expect(requested).toEqual([u1, u2]);

    // 第二張自己的逾時（3500 ms）到了、狀態改變使效果重跑，同一個網址也不會再載第二次（仍在第一次自動輪播的 8 秒之前）
    await advance(5000);
    expect(stateOf(slides(container)[1])).toBe('timeout');
    expect(requested).toEqual([u1, u2]);
  });

  it('慢網路：第一張逾時（1800 ms）只是取消壓暗並設背景圖、不算載好——圖片可能還在下載，這時不載下一張（不跟它搶頻寬）；載好後才載', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);

    await advance(1799);
    expect(stateOf(slides(container)[0])).toBe('loading');
    await advance(5201); // 到 7000 ms：仍在第一次自動輪播（8 秒）之前，目前還是第一張
    const first = slides(container)[0] as HTMLElement;
    expect(stateOf(first)).toBe('timeout');
    expect(first.classList.contains('banner-slide--loading')).toBe(false);
    expect(first.getAttribute('style')).toBe(bgOf(u1)); // 逾時後直接設背景圖（邊載邊顯示），和原本一致
    expect(requested).toEqual([u1]);

    await load(u1);
    expect(stateOf(first)).toBe('done');
    expect(requested).toEqual([u1, u2]);
  });

  it('自動輪播逐次推進（每次都等該次的 effect 跑完再看請求）：輪到哪一張才載哪一張；首圖逾時不會偷偷預取', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);
    const trackStyle = (): string => container.querySelector('#banner-track')?.getAttribute('style') ?? '';

    await advance(7000);
    expect(stateOf(slides(container)[0])).toBe('timeout');
    expect(requested).toEqual([u1]); // 第一次輪播之前：首圖逾時不觸發下一張

    await advance(1000); // 8000 ms：輪播到第 2 張
    expect(trackStyle()).toContain('translateX(-100%)');
    expect(requested).toEqual([u1, u2]);

    await advance(8000); // 16000 ms：輪播到第 3 張
    expect(trackStyle()).toContain('translateX(-200%)');
    expect(requested).toEqual([u1, u2, u3]);

    await advance(8000); // 24000 ms：輪播回第 1 張，沒有新的請求
    expect(trackStyle()).toContain('translateX(-0%)');
    expect(requested).toEqual([u1, u2, u3]);
  });

  it('逾時計時在「開始載那一張」時才啟動，不是掛載時就替每一張排計時：還沒開始載的張不會被標成逾時、也不會偷偷設背景圖', async () => {
    const [u1, u2] = urls(2) as [string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2)]);
    // 7 秒：第一張（1800 ms）早已逾時，但還沒到 8 秒的自動輪播，目前仍是第一張
    await advance(7000);
    // 第一張逾時了，第二張還沒開始載（第一張沒有結果）
    expect(stateOf(slides(container)[0])).toBe('timeout');
    expect(requested).toEqual([u1]);
    const second = slides(container)[1] as HTMLElement;
    expect(stateOf(second)).toBe('loading');
    expect(second.getAttribute('style') ?? '').toBe('');
  });

  it('第一張載入失敗也算有結果：照常載下一張', async () => {
    const [u1, u2] = urls(2) as [string, string];
    renderCarousel([banner('a', u1), banner('b', u2)]);
    await fail(u1);
    expect(requested).toEqual([u1, u2]);
  });

  it('點圓點直接跳到某張：只載那一張（第一張已經在載）', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);
    await act(async () => {
      fireEvent.click(container.querySelectorAll('#banner-dots .banner-dot')[2] as HTMLElement);
    });
    expect(requested).toEqual([u1, u3]);
  });

  it('畫面不是 <img>：沒有任何 <img> 元素', () => {
    const [u1, u2] = urls(2) as [string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2)]);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('HomeBannerCarousel 載入結果與畫面（與原本相同）', () => {
  it('載入中壓暗（無背景圖）；載入成功後取消壓暗、設 inline background-image（逐字與原本相同）；切頁回來略過淡入且不重載', async () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([banner('a', u1)]);
    let slide = slides(first.container)[0] as HTMLElement;
    expect(stateOf(slide)).toBe('loading');
    expect(slide.classList.contains('banner-slide--loading')).toBe(true);
    expect(slide.getAttribute('style')).toBeNull();

    await load(u1);
    slide = slides(first.container)[0] as HTMLElement;
    expect(stateOf(slide)).toBe('done');
    expect(slide.className).toBe('banner-slide');
    expect(slide.getAttribute('style')).toBe(bgOf(u1));
    cleanup();

    // 紀錄語意：「這次開啟期間曾載入成功」→ 重新進來直接 done、不重載；之後網址是否失效不偵測（原本也沒有）
    const again = renderCarousel([banner('a', u1)]);
    slide = slides(again.container)[0] as HTMLElement;
    expect(stateOf(slide)).toBe('done');
    expect(slide.getAttribute('style')).toBe(bgOf(u1));
    await flush();
    expect(requested).toEqual([u1]);
  });

  it('有連結：cursor:pointer 接在背景圖之後（和原本的字串順序相同）', async () => {
    const [u1] = urls(1) as [string];
    const { container } = renderCarousel([banner('a', u1, { linkUrl: 'https://example.com/go' })]);
    expect(slides(container)[0]?.getAttribute('style')).toBe(norm('cursor:pointer;'));
    await load(u1);
    expect(slides(container)[0]?.getAttribute('style')).toBe(norm(`background-image:url("${u1}");background-size:cover;background-position:center;cursor:pointer;`));
  });

  it('圖片載入失敗：維持原本畫面——取消壓暗、沒有新的佔位樣式（沒有漸層、底色、文字、子元素），只剩暗色遮罩透出頁面底色；之後重新進來會重新嘗試', async () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([
      banner('a', u1, { gradient: 'linear-gradient(135deg, #0d9488, #1e3a8a)' }),
    ]);

    await fail(u1);
    const slide = slides(first.container)[0] as HTMLElement;
    expect(stateOf(slide)).toBe('failed');
    expect(slide.className).toBe('banner-slide'); // 沒有 --loading（不壓暗）、沒有 --failed 之類的新 class
    expect(slide.getAttribute('style')).toBeNull(); // 沒有新的漸層／--bg-elevated 底色；壞網址的背景圖本來就什麼都不畫
    expect(slide.children).toHaveLength(0);
    expect(slide.textContent).toBe('');
    expect(first.container.querySelector('img')).toBeNull();
    cleanup();

    // 失敗不進「已載入」快取：重新進來又是載入中（重新嘗試一次；每次進來只結算一次，不是重試迴圈）。
    const again = renderCarousel([banner('a', u1)]);
    expect(stateOf(slides(again.container)[0])).toBe('loading');
  });

  it('失敗只結算一次、不重試：失敗之後經過很久也沒有再載同一個網址', async () => {
    const [u1] = urls(1) as [string];
    renderCarousel([banner('a', u1)]);
    await fail(u1);
    await advance(60_000);
    expect(requested).toEqual([u1]);
  });

  it('decode 被 reject（且 load 事件沒先到）也算失敗；load 先到就是成功、之後 decode 的 reject 不再改變結果（和原本相同：誰先到誰算，不等 decode）', async () => {
    installDecode();
    const [u1, u2] = urls(2) as [string, string];
    const a = renderCarousel([banner('a', u1)]);
    decodeCalls.find((c) => c.url === u1)?.reject(new Error('EncodingError'));
    await flush();
    expect(stateOf(slides(a.container)[0])).toBe('failed');
    cleanup();

    const b = renderCarousel([banner('b', u2)]);
    await load(u2); // load 先到：成功
    decodeCalls.find((c) => c.url === u2)?.reject(new Error('EncodingError'));
    await flush();
    expect(stateOf(slides(b.container)[0])).toBe('done');
  });

  it('decode 成功也算載入成功（load 事件還沒到時）', async () => {
    installDecode();
    const [u1] = urls(1) as [string];
    const { container } = renderCarousel([banner('a', u1)]);
    decodeCalls.find((c) => c.url === u1)?.resolve();
    await flush();
    expect(stateOf(slides(container)[0])).toBe('done');
  });

  it('逾時後圖片才載完：由 timeout 轉成 done；逾時後才失敗：由 timeout 轉成 failed（不再設背景圖）', async () => {
    const [u1, u2] = urls(2) as [string, string];
    const ok = renderCarousel([banner('a', u1)]);
    await advance(2000);
    expect(stateOf(slides(ok.container)[0])).toBe('timeout');
    await load(u1);
    expect(stateOf(slides(ok.container)[0])).toBe('done');
    cleanup();

    const bad = renderCarousel([banner('b', u2)]);
    await advance(2000);
    expect(slides(bad.container)[0]?.getAttribute('style')).toBe(bgOf(u2));
    await fail(u2);
    const slide = slides(bad.container)[0] as HTMLElement;
    expect(stateOf(slide)).toBe('failed');
    expect(slide.getAttribute('style') ?? '').toBe('');
  });

  it('網址含引號或反斜線時：preload 的 href 與 data-bg-src 都是原字串（背景圖的 CSS 跳脫沿用原本的運算式，解析後同一個網址；jsdom 無法往返解析跳脫後的 CSS，所以這裡只驗證 href）', async () => {
    const odd = 'https://img.example/odd/a"b\\c.webp';
    const { container } = renderCarousel([banner('a', odd)]);
    await load(odd);
    expect(stateOf(slides(container)[0])).toBe('done');
    expect(slides(container)[0]?.getAttribute('data-bg-src')).toBe(odd);
    expect(requested).toEqual([odd]);
    expect(preloadLinks().map((l) => l.getAttribute('href'))).toEqual([odd]);
  });

  it('底色漸層不合格（url、分號等）就用預設底色，不寫進 style（沒有圖片的橫幅）', () => {
    const evil = 'linear-gradient(red, blue); background-image:url(https://evil.example/x.png)';
    const plain = renderCarousel([banner('p', '', { gradient: evil })]);
    const style = (slides(plain.container)[0] as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('var(--bg-elevated)');
    expect(style).not.toContain('evil.example');
  });

  it('「已載入成功」的紀錄有上限（100 筆）：超過時丟掉最舊的（下次進來重做淡入），最新的仍在', async () => {
    const all = urls(105);
    for (const u of all) {
      renderCarousel([banner('cap', u)]);
      await load(u);
      cleanup();
    }
    const stateFor = (u: string): string | null => {
      const { container } = renderCarousel([banner('cap', u)]);
      const state = stateOf(slides(container)[0]);
      cleanup();
      return state;
    };
    expect(stateFor(all[0] as string), '最舊的（第 1 筆）被丟掉').toBe('loading');
    expect(stateFor(all[4] as string), '第 5 筆也被丟掉（105 − 100）').toBe('loading');
    expect(stateFor(all[5] as string), '第 6 筆還在').toBe('done');
    expect(stateFor(all[104] as string), '最新的還在').toBe('done');
  });
});

describe('HomeBannerCarousel 載入工作的生命週期（退修 8）', () => {
  it('卸載後才回來的 onload：不寫共用紀錄、不改畫面；新的畫面自己重新載（共用紀錄沒被污染），載好才是 done', async () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([banner('a', u1)]);
    expect(requested).toEqual([u1]);
    first.unmount();

    await act(async () => {
      (imagesFor(u1)[0] as FakeImage).onload?.(); // 舊工作晚到的 onload
    });
    const second = renderCarousel([banner('a', u1)]);
    expect(stateOf(slides(second.container)[0])).toBe('loading'); // 共用紀錄沒有被舊工作寫入
    expect(requested).toEqual([u1, u1]); // 新畫面自己開了新的載入工作

    await load(u1, 1);
    expect(stateOf(slides(second.container)[0])).toBe('done');
  });

  it('卸載後才回來的 decode：resolve 不寫共用紀錄、reject 不誤判失敗', async () => {
    installDecode();
    for (const oldResult of ['resolve', 'reject'] as const) {
      cleanup();
      decodeCalls.length = 0;
      const [u] = urls(1) as [string];
      const first = renderCarousel([banner('a', u)]);
      first.unmount();
      const call = decodeCalls.find((c) => c.url === u);
      if (oldResult === 'resolve') call?.resolve();
      else call?.reject(new Error('EncodingError'));
      await flush();

      const second = renderCarousel([banner('a', u)]);
      expect(stateOf(slides(second.container)[0]), `舊工作 ${oldResult}`).toBe('loading');
      expect(imagesFor(u)).toHaveLength(2);
    }
  });

  it('卸載時清掉逾時計時：沒有留下任何計時器', async () => {
    const [u1, u2] = urls(2) as [string, string];
    const view = renderCarousel([banner('a', u1), banner('b', u2)]);
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0); // 第一張的逾時、自動輪播
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('時序 ①～④：舊工作在「新畫面初始化之後、新畫面的載入 effect 之前」成功——不會污染共用紀錄，新畫面照樣自己載、不會卡在沒有背景圖', async () => {
    const [u] = urls(1) as [string];
    const old = renderCarousel([banner('a', u)]); // ① 舊畫面載入 u、尚未結算
    old.unmount();

    // ② 新畫面顯示 u，初始化時共用紀錄是空的（本地 loading）
    // ③ 新畫面的 layout 階段（早於所有 passive effect）舊工作成功
    function Staged(): preact.JSX.Element {
      useLayoutEffect(() => {
        (imagesFor(u)[0] as FakeImage).onload?.();
      }, []);
      return carousel([banner('a', u)]);
    }
    const view = render(<Staged />);
    await flush();
    const container = view.container as HTMLElement;

    // ④ 新畫面的 loadImage(u)：共用紀錄沒有被舊工作寫入，所以新畫面開了自己的載入工作並等它的結果
    expect(requested).toEqual([u, u]);
    expect(stateOf(slides(container)[0])).toBe('loading');
    await advance(2000);
    expect(stateOf(slides(container)[0])).toBe('timeout'); // 自己的逾時計時有建立
    await load(u, 1);
    expect(stateOf(slides(container)[0])).toBe('done');
    expect(slides(container)[0]?.getAttribute('style')).toBe(bgOf(u));
  });

  it('共用紀錄命中時同步本地狀態：別的畫面讓這張成功之後，清單才加進這張的畫面也拿得到 loaded（不會一直沒有背景圖）', async () => {
    const [a, b] = urls(2) as [string, string];
    const x = renderCarousel([banner('a', a)]); // 畫面 X 載入 a
    const y = renderCarousel([banner('b', b)]); // 畫面 Y 載入 b（初始化時共用紀錄沒有 a）
    await load(b);
    await load(a); // X 的 a 成功 → 寫進共用紀錄
    expect(stateOf(slides(x.container)[0])).toBe('done');

    y.rerender([banner('b', b), banner('a', a)]); // Y 的清單加進 a：目前這張（b）有結果 → 載下一張（a）→ 共用紀錄命中
    await flush();
    const slideA = slides(y.container)[1] as HTMLElement;
    expect(stateOf(slideA)).toBe('done');
    expect(slideA.getAttribute('style')).toBe(bgOf(a));
    expect(requested.filter((u) => u === a)).toHaveLength(1); // 命中就不重載
  });

  it('清單替換 A→B→A（期間沒有任何新的載入事件）：舊的 A 工作作廢——onload、decode 的 resolve／reject 都不能寫共用紀錄或改畫面；網址換回來是新的工作', async () => {
    installDecode();
    for (const oldResult of ['load', 'resolve', 'reject'] as const) {
      cleanup();
      decodeCalls.length = 0;
      const [uA, uB] = urls(2) as [string, string];
      const view = renderCarousel([banner('a', uA)]);
      const oldImg = imagesFor(uA)[0] as FakeImage;
      const oldDecode = decodeCalls.find((c) => c.url === uA);

      view.rerender([banner('b', uB)]);
      await flush();
      view.rerender([banner('a', uA)]);
      await flush();
      expect(imagesFor(uA)).toHaveLength(2); // 換回來是新的工作，沒有沿用舊的
      expect(stateOf(slides(view.container)[0]), '換回來時不沿用舊狀態').toBe('loading');

      // 舊的 A 工作這時才回來
      if (oldResult === 'load') await act(async () => { oldImg.onload?.(); });
      else if (oldResult === 'resolve') oldDecode?.resolve();
      else oldDecode?.reject(new Error('EncodingError'));
      await flush();
      expect(stateOf(slides(view.container)[0]), `舊工作 ${oldResult}`).toBe('loading');

      // 共用紀錄沒被污染：另一個畫面顯示 A 仍是載入中
      const other = renderCarousel([banner('a', uA)]);
      expect(stateOf(slides(other.container)[0]), `舊工作 ${oldResult}，另一個畫面`).toBe('loading');
      other.unmount();

      // 新的 A 工作才算數
      await load(uA, 1);
      expect(stateOf(slides(view.container)[0])).toBe('done');
    }
  });

  it('網址離開清單後它的晚到結果不得寫入：[A] → [B]，A 的 onload 晚到，之後重新進來 A 仍是載入中', async () => {
    const [uA, uB] = urls(2) as [string, string];
    const view = renderCarousel([banner('a', uA)]);
    view.rerender([banner('b', uB)]);
    await flush();
    await act(async () => {
      (imagesFor(uA)[0] as FakeImage).onload?.();
    });
    cleanup();
    const again = renderCarousel([banner('a', uA)]);
    expect(stateOf(slides(again.container)[0])).toBe('loading');
  });

  it('清單換成同一組網址的新陣列：不取消、不重載（去重）；原本的工作照樣算數', async () => {
    const [u1, u2] = urls(2) as [string, string];
    const view = renderCarousel([banner('a', u1), banner('b', u2)]);
    view.rerender([banner('a', u1), banner('b', u2)]);
    await flush();
    expect(requested).toEqual([u1]);
    await load(u1);
    expect(stateOf(slides(view.container)[0])).toBe('done');
    expect(requested).toEqual([u1, u2]);
  });

  it('替換後再換回來不沿用舊的逾時狀態：A 逾時（已設背景圖）→ [B] → [A]，A 回到載入中（沒有背景圖）、重新開始計時', async () => {
    const [uA, uB] = urls(2) as [string, string];
    const view = renderCarousel([banner('a', uA)]);
    await advance(2000);
    expect(stateOf(slides(view.container)[0])).toBe('timeout');

    view.rerender([banner('b', uB)]);
    await flush();
    view.rerender([banner('a', uA)]);
    await flush();
    const slide = slides(view.container)[0] as HTMLElement;
    expect(stateOf(slide)).toBe('loading');
    expect(slide.getAttribute('style') ?? '').toBe('');
    await advance(2000); // 新工作自己的逾時
    expect(stateOf(slides(view.container)[0])).toBe('timeout');
  });
});

describe('HomeBannerCarousel 提早下載：動態 preload link', () => {
  it('第一張在 <head> 加 <link rel="preload" as="image" fetchpriority="high">，href 與背景圖／data-bg-src 的網址字串一致；其餘張沒有', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);

    const links = preloadLinks();
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLLinkElement;
    expect(link.getAttribute('rel')).toBe('preload');
    expect(link.getAttribute('as')).toBe('image');
    expect(link.getAttribute('fetchpriority')).toBe('high');
    expect(link.getAttribute('href')).toBe(u1);
    expect(link.getAttribute('href')).toBe(slides(container)[0]?.getAttribute('data-bg-src'));

    // 背景圖用的就是同一個字串
    await load(u1);
    expect(slides(container)[0]?.getAttribute('style')).toContain(`url("${link.getAttribute('href')}")`);
  });

  it('卸載時移除 link，不累積；重新掛載同一組橫幅只會有一個', () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([banner('a', u1)]);
    expect(preloadLinks()).toHaveLength(1);
    first.unmount();
    expect(preloadLinks()).toHaveLength(0);

    renderCarousel([banner('a', u1)]);
    expect(preloadLinks()).toHaveLength(1);
  });

  it('列表替換（第一張網址改變）時：舊的 link 被移除、換成新的第一張，不累積；第一張網址沒變的重新渲染不重新加', () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const view = renderCarousel([banner('a', u1), banner('b', u2)]);
    expect(preloadLinks().map((l) => l.getAttribute('href'))).toEqual([u1]);

    view.rerender([banner('c', u3), banner('b', u2)]);
    expect(preloadLinks().map((l) => l.getAttribute('href'))).toEqual([u3]);

    const before = preloadLinks()[0];
    view.rerender([banner('c', u3), banner('x', u2)]);
    expect(preloadLinks()).toHaveLength(1);
    expect(preloadLinks()[0]).toBe(before);
  });

  it('不需要 preload 的情況：第一張沒有圖片網址、非 http(s) 網址、或這張這次開啟期間已經載入成功過', async () => {
    const [u1, u2] = urls(2) as [string, string];
    renderCarousel([banner('a', ''), banner('b', u2)]);
    expect(preloadLinks()).toHaveLength(0);
    cleanup();

    renderCarousel([banner('a', 'javascript:alert(1)'), banner('b', u2)]);
    renderCarousel([banner('a', 'data:image/png;base64,AAAA')]);
    expect(preloadLinks()).toHaveLength(0);
    expect(requested).not.toContain('javascript:alert(1)');
    cleanup();

    renderCarousel([banner('a', u1)]);
    expect(preloadLinks()).toHaveLength(1);
    await load(u1);
    cleanup();
    expect(preloadLinks()).toHaveLength(0);
    renderCarousel([banner('a', u1)]); // 已載入成功過：記憶體紀錄命中，不再 preload
    expect(preloadLinks()).toHaveLength(0);
  });

  it('帶 query 的網址：href 一字不差（含 ? 與 &）', () => {
    const [base] = urls(1) as [string];
    const u = `${base}?alt=media&token=ab%2Fcd&v=2`;
    renderCarousel([banner('a', u)]);
    expect(preloadLinks().map((l) => l.getAttribute('href'))).toEqual([u]);
  });

  it('只移除自己加的 link：外部本來就有的 preload（同網址或別的網址）不受影響', () => {
    const [u1] = urls(1) as [string];
    const external = document.createElement('link');
    external.setAttribute('rel', 'preload');
    external.setAttribute('as', 'image');
    external.setAttribute('href', u1); // 與橫幅同一個網址的外部 link
    document.head.appendChild(external);
    const other = document.createElement('link');
    other.setAttribute('rel', 'preload');
    other.setAttribute('as', 'image');
    other.setAttribute('href', 'https://img.example/other.webp');
    document.head.appendChild(other);

    const view = renderCarousel([banner('a', u1)]);
    expect(preloadLinks()).toHaveLength(3);
    view.unmount();
    expect(preloadLinks()).toEqual([external, other]);
  });
});

describe('HomeBannerCarousel 連結契約（儲存與使用同一個：只開 http/https）', () => {
  it('http/https 連結：點橫幅開新分頁；站內路徑或不合格連結沒有 handler、點了什麼都不會發生', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([
      banner('a', u1, { linkUrl: 'https://example.com/go' }),
      banner('b', u2, { linkUrl: '/events/abc' }),
      banner('c', u3, { linkUrl: 'javascript:alert(1)' }),
    ]);
    const [a, b, c] = slides(container) as [HTMLElement, HTMLElement, HTMLElement];

    expect(a.getAttribute('style')).toMatch(/cursor:\s*pointer/);
    fireEvent.click(a);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/go', 'sporthub_ad', 'noopener,noreferrer');

    for (const slide of [b, c]) {
      expect(slide.getAttribute('style') ?? '').not.toMatch(/cursor:\s*pointer/);
      fireEvent.click(slide);
    }
    expect(open).toHaveBeenCalledTimes(1);
  });
});
