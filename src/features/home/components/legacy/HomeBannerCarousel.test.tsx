import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import type { BannerDoc } from '../../data/banners';
import { HomeBannerCarousel } from './HomeBannerCarousel';

// T-042 退修 1：橫幅圖的載入策略與狀態。
// - 圖片由 <img> 自己載入（第一張 fetchpriority=high＋eager，其餘 lazy），不再有「120 ms 後把全部橫幅都預載」；
// - 預取只預取「下一張」，而且等目前這張有結果（載好／失敗／逾時）之後；
// - 成功／失敗／逾時分開：失敗改顯示底色，逾時只是取消壓暗、不當成失敗。
// 模組內有「已載入成功」的快取（切頁回來不重做淡入），所以每個案例用不同的圖片網址。

const noop = (): void => undefined;

let seq = 0;
function urls(count: number): string[] {
  seq += 1;
  return Array.from({ length: count }, (_, i) => `https://img.example/${seq}/${i + 1}.webp`);
}

function banner(id: string, image: string, extra: Partial<BannerDoc> = {}): BannerDoc {
  return { id, _docId: id, status: 'active', title: id, image, ...extra };
}

function renderCarousel(banners: BannerDoc[]): { container: HTMLElement } {
  const { container } = render(
    <HomeBannerCarousel
      banners={banners}
      onOpenNearbyMap={noop}
      onOpenSearchModal={noop}
      onOpenCreateEvent={noop}
      canCreate={false}
    />,
  );
  return { container: container as HTMLElement };
}

function slides(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('#banner-track .banner-slide'));
}

const requested: string[] = [];
class FakeImage {
  decoding = '';
  set src(value: string) {
    requested.push(value);
  }
}

beforeEach(() => {
  requested.length = 0;
  vi.stubGlobal('Image', FakeImage);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
});

describe('HomeBannerCarousel 載入策略', () => {
  it('不再把全部橫幅都預載：目前這張還沒有結果前不預取；載好後只預取下一張', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);

    // 原本 120 ms 後會把第二、三張都預載；現在什麼都不會發生（第一張逾時是 1800 ms）。
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(requested).toEqual([]);

    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
    await act(async () => {
      fireEvent.load(imgs[0] as HTMLImageElement);
    });
    // 目前這張載好 → 只預取下一張，第三張不動。
    expect(requested).toEqual([u2]);

    // 重新渲染不會重複預取同一張。
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(requested).toEqual([u2]);
  });

  it('慢網路：第一張逾時（1800 ms）只是取消壓暗、不算載好——圖片可能還在下載，這時不預取下一張（不跟它搶頻寬）；載好後才預取', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);

    await act(async () => {
      vi.advanceTimersByTime(1799);
    });
    expect(requested).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    // 逾時狀態：取消壓暗、不當失敗，但仍沒有任何預取請求
    const first = slides(container)[0] as HTMLElement;
    expect(first.getAttribute('data-banner-load-state')).toBe('timeout');
    expect(first.classList.contains('banner-slide--loading')).toBe(false);
    expect(first.querySelector('img')).toBeTruthy();
    expect(requested).toEqual([]);

    // 第一張終於載好 → 才預取第二張
    await act(async () => {
      fireEvent.load(first.querySelector('img') as HTMLImageElement);
    });
    expect(requested).toEqual([u2]);
  });

  it('第一張載入失敗也算有結果：照常預取下一張', async () => {
    const [u1, u2] = urls(2) as [string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2)]);
    await act(async () => {
      fireEvent.error(container.querySelector('img') as HTMLImageElement);
    });
    expect(requested).toEqual([u2]);
  });

  it('點圓點直接跳到某張：只預取那一張', async () => {
    const [u1, u2, u3] = urls(3) as [string, string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2), banner('c', u3)]);

    await act(async () => {
      fireEvent.click(container.querySelectorAll('#banner-dots .banner-dot')[2] as HTMLElement);
    });
    expect(requested).toEqual([u3]);
  });

  it('<img> 屬性：只有第一張 fetchpriority=high＋eager，其餘 lazy', () => {
    const [u1, u2] = urls(2) as [string, string];
    const { container } = renderCarousel([banner('a', u1), banner('b', u2)]);
    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy']);
    expect(imgs.map((i) => i.getAttribute('fetchpriority'))).toEqual(['high', null]);
  });
});

describe('HomeBannerCarousel 載入結果', () => {
  it('載入成功（含解碼）才算 done：載入中壓暗，成功後取消壓暗；切頁回來不再重做淡入', async () => {
    const [u1] = urls(1) as [string];
    HTMLImageElement.prototype.decode = vi.fn(() => Promise.resolve());
    const first = renderCarousel([banner('a', u1)]);
    let slide = slides(first.container)[0] as HTMLElement;
    expect(slide.getAttribute('data-banner-load-state')).toBe('loading');
    expect(slide.classList.contains('banner-slide--loading')).toBe(true);

    await act(async () => {
      fireEvent.load(first.container.querySelector('img') as HTMLImageElement);
    });
    slide = slides(first.container)[0] as HTMLElement;
    expect(slide.getAttribute('data-banner-load-state')).toBe('done');
    expect(slide.classList.contains('banner-slide--loading')).toBe(false);
    cleanup();

    const again = renderCarousel([banner('a', u1)]);
    slide = slides(again.container)[0] as HTMLElement;
    expect(slide.getAttribute('data-banner-load-state')).toBe('done');
  });

  it('圖片載入失敗：改顯示底色（不留壞圖、不顯示開發用佔位字）；之後重新進來會重新嘗試', async () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([banner('a', u1, { gradient: 'linear-gradient(135deg, #0d9488, #1e3a8a)' })]);

    await act(async () => {
      fireEvent.error(first.container.querySelector('img') as HTMLImageElement);
    });
    const slide = slides(first.container)[0] as HTMLElement;
    expect(slide.getAttribute('data-banner-load-state')).toBe('failed');
    expect(slide.classList.contains('banner-slide--failed')).toBe(true);
    expect(slide.querySelector('img')).toBeNull();
    expect(slide.textContent).not.toContain('1200');
    // jsdom 會把顏色正規化成 rgb()，只確認有套用到漸層
    expect(slide.getAttribute('style')).toContain('linear-gradient(135deg');
    cleanup();

    // 失敗不進「已載入」快取：重新進來又是載入中。
    const again = renderCarousel([banner('a', u1)]);
    expect((slides(again.container)[0] as HTMLElement).getAttribute('data-banner-load-state')).toBe('loading');
  });

  it('解碼失敗（decode 被 reject）也算失敗', async () => {
    const [u1] = urls(1) as [string];
    HTMLImageElement.prototype.decode = vi.fn(() => Promise.reject(new Error('EncodingError')));
    const { container } = renderCarousel([banner('a', u1)]);

    await act(async () => {
      fireEvent.load(container.querySelector('img') as HTMLImageElement);
    });
    expect((slides(container)[0] as HTMLElement).getAttribute('data-banner-load-state')).toBe('failed');
  });

  it('逾時後圖片才載完：由 timeout 轉成 done', async () => {
    const [u1] = urls(1) as [string];
    const { container } = renderCarousel([banner('a', u1)]);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect((slides(container)[0] as HTMLElement).getAttribute('data-banner-load-state')).toBe('timeout');

    await act(async () => {
      fireEvent.load(container.querySelector('img') as HTMLImageElement);
    });
    expect((slides(container)[0] as HTMLElement).getAttribute('data-banner-load-state')).toBe('done');
  });

  it('底色漸層不合格（url、分號等）就用預設底色，不寫進 style', async () => {
    const [u1] = urls(1) as [string];
    const evil = 'linear-gradient(red, blue); background-image:url(https://evil.example/x.png)';
    // 失敗的圖片 slide 與沒有圖片的 slide 都用同一個過濾
    const failed = renderCarousel([banner('a', u1, { gradient: evil })]);
    await act(async () => {
      fireEvent.error(failed.container.querySelector('img') as HTMLImageElement);
    });
    const failedStyle = (slides(failed.container)[0] as HTMLElement).getAttribute('style') ?? '';
    expect(failedStyle).toContain('var(--bg-elevated)');
    expect(failedStyle).not.toContain('evil.example');
    cleanup();

    const plain = renderCarousel([banner('p', '', { gradient: evil })]);
    const style = (slides(plain.container)[0] as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('var(--bg-elevated)');
    expect(style).not.toContain('evil.example');
  });

  it('「已載入成功」的紀錄有上限（100 筆）：超過時丟掉最舊的（下次進來重做淡入），最新的仍在', async () => {
    const all = urls(105);
    for (const u of all) {
      const { container } = renderCarousel([banner('cap', u)]);
      await act(async () => {
        fireEvent.load(container.querySelector('img') as HTMLImageElement);
      });
      cleanup();
    }
    const stateFor = (u: string): string | null => {
      const { container } = renderCarousel([banner('cap', u)]);
      const state = (slides(container)[0] as HTMLElement).getAttribute('data-banner-load-state');
      cleanup();
      return state;
    };
    expect(stateFor(all[0] as string), '最舊的（第 1 筆）被丟掉').toBe('loading');
    expect(stateFor(all[4] as string), '第 5 筆也被丟掉（105 − 100）').toBe('loading');
    expect(stateFor(all[5] as string), '第 6 筆還在').toBe('done');
    expect(stateFor(all[104] as string), '最新的還在').toBe('done');
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

describe('HomeBannerCarousel decode 的生命週期', () => {
  type Job = { resolve: () => void; reject: (e: unknown) => void; settled: Promise<void> };
  const jobs: Job[] = [];
  /** 每次 decode() 呼叫都產生一個可個別 resolve／reject 的工作，依呼叫順序放進 jobs。 */
  function installDecode(): void {
    jobs.length = 0;
    HTMLImageElement.prototype.decode = vi.fn(() => {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      jobs.push({ resolve, reject, settled: promise.then(() => undefined, () => undefined) });
      return promise;
    });
  }
  /** 完成訊號：讓目前已排入的 Promise 工作（含 decode 的 then 與 Preact 的重繪）跑完——只保證這一刻之前排入的，不含之後才排入的。 */
  const flush = (): Promise<void> => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const stateOf = (container: HTMLElement): string | null =>
    (slides(container)[0] as HTMLElement).getAttribute('data-banner-load-state');
  const props = { onOpenNearbyMap: noop, onOpenSearchModal: noop, onOpenCreateEvent: noop, canCreate: false };
  const imgOf = (container: HTMLElement): HTMLImageElement => container.querySelector('img') as HTMLImageElement;

  beforeEach(() => {
    installDecode();
  });

  it('畫面卸載後才解碼完成：結果作廢，不會記成「已載入成功」', async () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([banner('a', u1)]);
    await act(async () => {
      fireEvent.load(imgOf(first.container));
    });
    cleanup();
    jobs[0]?.resolve();
    await flush();

    // 重新進來：不能因為卸載後才完成的解碼而直接當作已載入
    const again = renderCarousel([banner('a', u1)]);
    expect(stateOf(again.container)).toBe('loading');
  });

  it('列表替換（那個 <img> 已被移除）後才解碼完成：結果作廢', async () => {
    const [u1, u2] = urls(2) as [string, string];
    const view = render(<HomeBannerCarousel banners={[banner('a', u1)]} {...props} />);
    await act(async () => {
      fireEvent.load(imgOf(view.container as HTMLElement));
    });
    view.rerender(<HomeBannerCarousel banners={[banner('b', u2)]} {...props} />);
    jobs[0]?.resolve();
    await flush();
    view.rerender(<HomeBannerCarousel banners={[banner('a', u1)]} {...props} />);
    expect(stateOf(view.container as HTMLElement)).toBe('loading');
  });

  it('網址改變、中間沒有任何新的 load 事件（A→B→A）：舊的 A 解碼工作回來時作廢——resolve 不會記成「已載入成功」、reject 不會誤判失敗', async () => {
    for (const oldResult of ['resolve', 'reject'] as const) {
      cleanup();
      installDecode();
      const [uA, uB] = urls(2) as [string, string];
      const view = render(<HomeBannerCarousel banners={[banner('a', uA)]} {...props} />);
      const elA = imgOf(view.container as HTMLElement);
      await act(async () => {
        fireEvent.load(elA); // 工作 0：A
      });
      expect(jobs).toHaveLength(1);

      // 換成 B、再換回 A，期間沒有新的 load 事件（真實瀏覽器裡新圖的 load 是非同步才到的）
      view.rerender(<HomeBannerCarousel banners={[banner('a', uB)]} {...props} />);
      view.rerender(<HomeBannerCarousel banners={[banner('a', uA)]} {...props} />);
      expect(elA.isConnected, '網址一變，舊元素就被換掉').toBe(false);
      expect(imgOf(view.container as HTMLElement)).not.toBe(elA);
      expect(jobs).toHaveLength(1);

      // 舊的 A 工作這時才回來：網址剛好又是 A，但它屬於已被換掉的元素 → 作廢
      if (oldResult === 'resolve') jobs[0]?.resolve();
      else jobs[0]?.reject(new Error('EncodingError'));
      await flush();
      expect(stateOf(view.container as HTMLElement), `舊工作 ${oldResult}`).toBe('loading');

      // 成功紀錄沒被污染：重新進來 A 仍是載入中
      cleanup();
      const again = renderCarousel([banner('a', uA)]);
      expect(stateOf(again.container), `舊工作 ${oldResult}，重新進來`).toBe('loading');
    }
  });

  it('A→B→A 且每次換圖都有新的 load 事件：只有最新的 A 工作算數（舊的 A 工作 resolve／reject 都作廢）', async () => {
    for (const oldResult of ['resolve', 'reject'] as const) {
      cleanup();
      installDecode();
      const [uA, uB] = urls(2) as [string, string];
      const view = render(<HomeBannerCarousel banners={[banner('a', uA)]} {...props} />);
      await act(async () => {
        fireEvent.load(imgOf(view.container as HTMLElement)); // 工作 0：A
      });
      view.rerender(<HomeBannerCarousel banners={[banner('a', uB)]} {...props} />);
      await act(async () => {
        fireEvent.load(imgOf(view.container as HTMLElement)); // 工作 1：B
      });
      view.rerender(<HomeBannerCarousel banners={[banner('a', uA)]} {...props} />);
      await act(async () => {
        fireEvent.load(imgOf(view.container as HTMLElement)); // 工作 2：A（最新）
      });
      expect(jobs).toHaveLength(3);

      if (oldResult === 'resolve') jobs[0]?.resolve();
      else jobs[0]?.reject(new Error('EncodingError'));
      await flush();
      expect(stateOf(view.container as HTMLElement), `舊工作 ${oldResult}`).toBe('loading');

      jobs[2]?.resolve();
      await flush();
      expect(stateOf(view.container as HTMLElement)).toBe('done');
    }
  });

  it('同一個元素連續兩次 load：較舊的解碼工作作廢，以最新的為準（resolve 與 reject 兩種舊結果）', async () => {
    for (const oldResult of ['resolve', 'reject'] as const) {
      cleanup();
      installDecode();
      const [u1] = urls(1) as [string];
      const view = renderCarousel([banner('a', u1)]);
      const img = imgOf(view.container);
      await act(async () => {
        fireEvent.load(img); // 工作 0
      });
      await act(async () => {
        fireEvent.load(img); // 工作 1（最新）
      });
      expect(jobs).toHaveLength(2);

      if (oldResult === 'resolve') jobs[0]?.resolve();
      else jobs[0]?.reject(new Error('EncodingError'));
      await flush();
      expect(stateOf(view.container), `舊工作 ${oldResult}`).toBe('loading');

      jobs[1]?.resolve();
      await flush();
      expect(stateOf(view.container)).toBe('done');
    }
  });

  it('曾經載入成功、後來失敗：撤掉「已載入成功」的紀錄，下次進來重新嘗試', async () => {
    const [u1] = urls(1) as [string];
    const first = renderCarousel([banner('a', u1)]);
    const img = imgOf(first.container);
    await act(async () => {
      fireEvent.load(img);
    });
    jobs[0]?.resolve();
    await flush();
    expect(stateOf(first.container)).toBe('done');
    await act(async () => {
      fireEvent.error(img);
    });
    expect(stateOf(first.container)).toBe('failed');
    cleanup();

    const again = renderCarousel([banner('a', u1)]);
    expect(stateOf(again.container)).toBe('loading');
  });
});
