import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetBannersRestForTest, startBannersRestFetch } from './banners-rest';
import { jsonResponse, restActiveFields, restDoc, restEmptyMarker, restStr } from './__fixtures__/banners-rest';

// T-042d：index.html 內嵌 script 提早發出的 REST（window.__fcbEarlyBanners）由 startBannersRestFetch 接手。
// 這裡只測資料層的接手規則：用早期結果、與自發互斥、失敗只退回 SDK 不補發、每次頁面載入只取一次。假的 fetch，不連線。

const IMAGE = 'https://firebasestorage.googleapis.com/v0/b/b/o/a.webp?alt=media';
const payload = [
  restDoc('b1', restActiveFields({ title: restStr('早期標題'), image: restStr(IMAGE), uid: restStr('secret-uid'), email: restStr('a@b.c') })),
  restEmptyMarker(),
];

let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  _resetBannersRestForTest();
  delete window.__fcbEarlyBanners;
  fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload).response);
});
afterEach(() => {
  delete window.__fcbEarlyBanners;
  vi.restoreAllMocks();
});

describe('startBannersRestFetch：接手 index.html 提早發出的請求（T-042d）', () => {
  it('早期 Promise 有原始回應：走同一條 parseRunQueryResponse 映射，不再自己發，全域被取走', async () => {
    window.__fcbEarlyBanners = Promise.resolve(payload);

    const request = startBannersRestFetch({ fetchImpl });

    expect(request).not.toBeNull();
    const list = await request?.result;
    expect(list).toHaveLength(1);
    expect(list?.[0]).toMatchObject({ id: 'b1', _docId: 'b1', status: 'active', title: '早期標題', image: IMAGE });
    // 映射只留 mapBannerDoc 認得的欄位：原始回應裡的 uid／email 不會出現。
    expect(JSON.stringify(list)).not.toMatch(/secret-uid|a@b\.c/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(window.__fcbEarlyBanners).toBeUndefined();
  });

  it('早期請求失敗（resolve null）：結果是 null、不補發第二次 REST（只退回 SDK），只留一行固定的 debug', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.__fcbEarlyBanners = Promise.resolve(null);

    const request = startBannersRestFetch({ fetchImpl });

    await expect(request?.result).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith('[banners-rest] fallback to SDK');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['回應不是陣列（物件）', { documents: [] }],
    ['回應是字串', 'oops'],
    ['含 error 元素', [{ error: { code: 403, message: 'denied' } }]],
  ])('早期回應格式不符（%s）：結果是 null，不補發', async (_name, raw) => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    window.__fcbEarlyBanners = Promise.resolve(raw);

    await expect(startBannersRestFetch({ fetchImpl })?.result).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('早期 Promise 被拒絕（理論上不會，內嵌 script 一律 resolve null）：同樣靜默回 null，不補發、不丟錯', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const early = Promise.reject(new Error('boom'));
    window.__fcbEarlyBanners = early;

    // 用 catch 把「結果 Promise 被拒絕」轉成一個可斷言的值（直接用 resolves 時失敗訊息不是斷言錯誤，變異判讀會歸成其他錯誤）。
    const settled = await startBannersRestFetch({ fetchImpl })?.result.catch((error: unknown) => `REJECTED:${String(error)}`);
    expect(settled).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('早期回應只有空結果標記：結果是空陣列（HomePage 不畫、交給 SDK 判斷）', async () => {
    window.__fcbEarlyBanners = Promise.resolve([restEmptyMarker()]);
    await expect(startBannersRestFetch({ fetchImpl })?.result).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('接手 thenable（Promise-like）也可以', async () => {
    window.__fcbEarlyBanners = { then: (resolve: (value: unknown) => void) => resolve(payload) } as unknown as Promise<unknown>;
    const list = await startBannersRestFetch({ fetchImpl })?.result;
    expect(list?.[0]?.id).toBe('b1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancel() 不影響早期請求（它屬於頁面載入本身）：不丟錯，結果照常', async () => {
    window.__fcbEarlyBanners = Promise.resolve(payload);
    const request = startBannersRestFetch({ fetchImpl });
    expect(() => request?.cancel()).not.toThrow();
    expect((await request?.result)?.[0]?.id).toBe('b1');
  });

  it.each([
    ['沒有全域', undefined],
    ['null', null],
    ['物件', { items: [] }],
    ['字串', 'promise'],
    ['數字', 1],
    ['then 不是函式', { then: 'x' }],
  ])('沒有可用的早期請求（%s）：照 T-042c 的路徑自己發一次', async (_name, value) => {
    if (value !== undefined) window.__fcbEarlyBanners = value as unknown as Promise<unknown>;

    const request = startBannersRestFetch({ fetchImpl });

    const list = await request?.result;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(list?.[0]?.id).toBe('b1');
    // 不是 Promise 的值也被清掉，不留在 window 上。
    expect(window.__fcbEarlyBanners).toBeUndefined();
  });

  it('每次頁面載入只取一次：第一次接手後，之後再呼叫一律 null，新掛上的全域也不會被取走', async () => {
    window.__fcbEarlyBanners = Promise.resolve(payload);
    expect(startBannersRestFetch({ fetchImpl })).not.toBeNull();

    const later = Promise.resolve(payload);
    window.__fcbEarlyBanners = later;
    expect(startBannersRestFetch({ fetchImpl })).toBeNull();
    expect(window.__fcbEarlyBanners).toBe(later);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('早期請求與自發互斥：同一次頁面載入不論走哪條路，fetchImpl 最多被呼叫一次', async () => {
    // 先自發（沒有早期請求）。
    await startBannersRestFetch({ fetchImpl })?.result;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 之後即使出現早期 Promise，也不會再有第二個請求或接手。
    window.__fcbEarlyBanners = Promise.resolve(payload);
    expect(startBannersRestFetch({ fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
