// @vitest-environment node
/**
 * 網頁推播接收（W4，public/sw-push.js）：讀真檔、用假 self 執行。
 * 案例編號對照設計書 web-push-w4-sw-design-2026-11-24.md §5.1（P1～P11、C1～C8、S1）。
 * 反斜線、換行、tab 一律用 String.fromCharCode 組，避免跳脫字元被編輯工具展開。
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pushPath = new URL('../public/sw-push.js', import.meta.url);
const configPath = new URL('../vite.config.ts', import.meta.url);
const ORIGIN = 'https://toosterx.com';
const ICON = '/assets/icons/icon-192x192.png';
const BS = String.fromCharCode(92);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

const source = await readFile(pushPath, 'utf8');

/** 假 self：記錄監聽、通知與視窗操作。rejectShow 為要拒絕的第幾次（1 起算）呼叫。 */
function load({ rejectShow = [], clients = [], matchAllReject = false, openWindowReject = false } = {}) {
  const listeners = {};
  const added = [];
  const shown = [];
  const log = [];
  let showCount = 0;
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => {
      added.push(type);
      listeners[type] = fn;
    },
    registration: {
      showNotification: (title, options) => {
        showCount += 1;
        shown.push([title, options]);
        return rejectShow.includes(showCount) ? Promise.reject(new TypeError('bad options')) : Promise.resolve();
      },
    },
    clients: {
      matchAll: (opts) => {
        log.push(['matchAll', opts]);
        return matchAllReject ? Promise.reject(new Error('matchAll')) : Promise.resolve(clients);
      },
      openWindow: (href) => {
        log.push(['openWindow', href]);
        return openWindowReject ? Promise.reject(new Error('openWindow')) : Promise.resolve(null);
      },
    },
  };
  new Function('self', source)(self);
  return { listeners, added, shown, log, self };
}

/** 假視窗：focus 回自己，navigate 可設定拒絕。 */
function fakeClient(log, url, { focused = false, visibilityState = 'hidden', navigateReject = false } = {}) {
  const client = {
    url,
    focused,
    visibilityState,
    focus: () => {
      log.push(['focus', url]);
      return Promise.resolve(client);
    },
    navigate: (href) => {
      log.push(['navigate', url, href]);
      return navigateReject ? Promise.reject(new TypeError('not controlled')) : Promise.resolve(client);
    },
  };
  return client;
}

/** 送一則推播，回傳 waitUntil 收到的 Promise 是否 resolve。 */
async function push(ctx, data) {
  let pending = null;
  ctx.listeners.push({ data, waitUntil: (p) => { pending = p; } });
  expect(pending).not.toBeNull();
  return pending.then(() => 'resolved', () => 'rejected');
}

const textData = (text) => ({ text: () => text });
const jsonData = (obj) => textData(JSON.stringify(obj));

/** 用 url 送一則正常推播，回傳通知 data.url。 */
async function storedUrl(url) {
  const ctx = load();
  expect(await push(ctx, jsonData({ v: 1, title: 't', body: 'b', url }))).toBe('resolved');
  expect(ctx.shown).toHaveLength(1);
  return ctx.shown[0][1].data.url;
}

async function click(ctx, data) {
  let pending = null;
  let closed = 0;
  ctx.listeners.notificationclick({
    notification: { data, close: () => { closed += 1; } },
    waitUntil: (p) => { pending = p; },
  });
  const result = pending ? await pending.then(() => 'resolved', () => 'rejected') : 'none';
  return { closed, result };
}

const OFFSITE = [
  'https://evil.com/x',
  '//evil.com',
  `/${BS}evil.com`,
  'javascript:alert(1)',
  'data:text/html,x',
  '',
  'inbox',
  ' /x',
  `/a${LF}b`,
  `/a${TAB}b`,
  `/${'a'.repeat(512)}`,
  '/..//evil.com',
  '/.//evil.com',
  '/%2e%2e//evil.com',
  '/a/..//evil.com',
];

describe('sw-push：載入與頂層安全', () => {
  it('P1 只登記 push、notificationclick 各一次', () => {
    const { added } = load();
    expect(added).toEqual(['push', 'notificationclick']);
    for (const t of ['fetch', 'install', 'activate', 'message', 'pushsubscriptionchange']) expect(added).not.toContain(t);
  });

  it('P2 addEventListener 丟錯、沒有 registration、沒有 location、沒有 URL 都不丟錯', () => {
    const throwing = { addEventListener: () => { throw new Error('x'); } };
    expect(() => new Function('self', source)(throwing)).not.toThrow();
    expect(() => new Function('self', source)({ location: { origin: ORIGIN }, addEventListener() {} })).not.toThrow();
    expect(() => new Function('self', source)({ registration: {}, addEventListener() {} })).not.toThrow();
    expect(() => new Function('self', 'URL', source)({ location: { origin: ORIGIN }, addEventListener() {} }, undefined)).not.toThrow();
    expect(() => new Function('self', source)({})).not.toThrow();
  });

  it('P3 靜態檢查：沒有禁用 API 與 ES2017 以後語法、可編譯、無 BOM、≤ 5,120 B', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const token of ['importScripts', 'fetch(', 'XMLHttpRequest', 'import(', 'caches', 'indexedDB', 'skipWaiting', 'clients.claim', 'postMessage', '?.', '??', 'async ', 'await ']) {
      expect(code.includes(token), token).toBe(false);
    }
    expect(() => new vm.Script(source)).not.toThrow();
    expect(source.charCodeAt(0)).not.toBe(0xfeff);
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThanOrEqual(5120);
    // 正則的控制字元跳脫必須是字面反斜線 u（不是被展開的真字元）。
    expect(source.includes(`${BS}u0000-${BS}u001f${BS}u007f`)).toBe(true);
    expect(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(source)).toBe(false);
  });
});

describe('sw-push：push 事件', () => {
  it('P4 正常內容：標題、內文、圖示、data.url，options 鍵精確為 body,icon,data', async () => {
    const ctx = load();
    expect(await push(ctx, jsonData({ v: 1, title: 'T', body: 'B', url: '/inbox' }))).toBe('resolved');
    expect(ctx.shown).toEqual([['T', { body: 'B', icon: ICON, data: { url: '/inbox' } }]]);
    expect(Object.keys(ctx.shown[0][1])).toEqual(['body', 'icon', 'data']);
  });

  it('P5 壞內容不丟錯，仍顯示一則站名通知、開首頁', async () => {
    const bad = [
      null,
      textData('not json'),
      textData('null'),
      textData('[]'),
      jsonData({ v: 2, title: 't', body: 'b', url: '/inbox' }),
      jsonData({ v: '1', title: 't', body: 'b', url: '/inbox' }),
      jsonData({ v: 1, body: 'b', url: '/inbox' }),
      jsonData({ v: 1, title: 5, body: 'b', url: '/inbox' }),
      jsonData({ v: 1, title: 't', body: 'b', url: 5 }),
      { text: () => { throw new Error('boom'); } },
    ];
    for (const data of bad) {
      const ctx = load();
      expect(await push(ctx, data)).toBe('resolved');
      expect(ctx.shown).toEqual([['ToosterX', { body: '', icon: ICON, data: { url: '/' } }]]);
    }
  });

  it('P6 多餘欄位照常顯示但不讀', async () => {
    const ctx = load();
    await push(ctx, jsonData({ v: 1, title: 'T', body: 'B', url: '/inbox', uid: 'x', eventId: 'y' }));
    expect(ctx.shown).toEqual([['T', { body: 'B', icon: ICON, data: { url: '/inbox' } }]]);
  });

  it('P7 站外與可疑網址一律退回 /；站內路徑原樣', async () => {
    for (const url of OFFSITE) expect(await storedUrl(url), JSON.stringify(url)).toBe('/');
    expect(await storedUrl('/inbox')).toBe('/inbox');
    expect(await storedUrl('/events/abc?x=1#y')).toBe('/events/abc?x=1#y');
    expect(await storedUrl('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
  });

  it('P8 截斷：標題 80、內文 180 個字元，代理對不切半', async () => {
    const ctx = load();
    await push(ctx, jsonData({ v: 1, title: 'x'.repeat(100), body: 'y'.repeat(200), url: '/' }));
    expect(ctx.shown[0][0]).toBe('x'.repeat(80));
    expect(ctx.shown[0][1].body).toBe('y'.repeat(180));
    const emoji = String.fromCodePoint(0x1f600);
    const ctx2 = load();
    await push(ctx2, jsonData({ v: 1, title: emoji.repeat(100), body: '', url: '/' }));
    expect(ctx2.shown[0][0]).toBe(emoji.repeat(80));
    expect(Array.from(ctx2.shown[0][0])).toHaveLength(80);
  });

  it('P9 顯示失敗補最小版；兩次都失敗 waitUntil 仍 resolve', async () => {
    const once = load({ rejectShow: [1] });
    expect(await push(once, jsonData({ v: 1, title: 'T', body: 'B', url: '/inbox' }))).toBe('resolved');
    expect(once.shown).toHaveLength(2);
    expect(once.shown[1]).toEqual(['ToosterX', { data: { url: '/' } }]);
    const twice = load({ rejectShow: [1, 2] });
    expect(await push(twice, jsonData({ v: 1, title: 'T', body: 'B', url: '/inbox' }))).toBe('resolved');
    expect(twice.shown).toHaveLength(2);
  });

  it('P10 waitUntil 丟錯時監聽不丟錯', () => {
    const ctx = load();
    expect(() => ctx.listeners.push({ data: jsonData({ v: 1, title: 'T', body: 'B', url: '/' }), waitUntil: () => { throw new Error('x'); } })).not.toThrow();
  });

  it('P11 處理兩次＝處理一次，結果都以單一 / 開頭', async () => {
    const extra = ['/./', '/..', '/a/./b/../c', '/a b', '/活動/報名', '/?//x', '/#//x', '/..%2f..%2fevil.com', `/${'a'.repeat(511)}`, '/inbox', '/%2F%2Fevil.com'];
    for (const url of [...OFFSITE, ...extra]) {
      const once = await storedUrl(url);
      const twice = await storedUrl(once);
      expect(twice, JSON.stringify(url)).toBe(once);
      expect(once.startsWith('/'), JSON.stringify(url)).toBe(true);
      expect(once.startsWith('//'), JSON.stringify(url)).toBe(false);
    }
  });
});

describe('sw-push：notificationclick 事件', () => {
  const HREF = `${ORIGIN}/inbox`;

  it('C1 沒有視窗：關通知、開新視窗', async () => {
    const ctx = load();
    const r = await click(ctx, { url: '/inbox' });
    expect(r).toEqual({ closed: 1, result: 'resolved' });
    expect(ctx.log).toEqual([['matchAll', { type: 'window', includeUncontrolled: true }], ['openWindow', HREF]]);
  });

  it('C2 有同源視窗在別頁：先 focus 再 navigate，不開新窗', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`)] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', `${ORIGIN}/events`], ['navigate', `${ORIGIN}/events`, HREF]]);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
  });

  it('C3 已有視窗就在該頁：只 focus', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, HREF)] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', HREF]]);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
  });

  it('C4 navigate 被拒：改開新視窗', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`, { navigateReject: true })] });
    const r = await click(ctx, { url: '/inbox' });
    expect(r.result).toBe('resolved');
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toEqual([['openWindow', HREF]]);
  });

  it('C5 多個視窗：網址完全相同 > focused／visible > 第一個', async () => {
    let log = [];
    let ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/b`, { visibilityState: 'visible' }), fakeClient(log, HREF)] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', HREF]]);

    log = [];
    ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/b`, { visibilityState: 'visible' })] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', `${ORIGIN}/b`], ['navigate', `${ORIGIN}/b`, HREF]]);

    log = [];
    ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/c`, { focused: true })] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', `${ORIGIN}/c`], ['navigate', `${ORIGIN}/c`, HREF]]);

    log = [];
    ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/b`)] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', `${ORIGIN}/a`], ['navigate', `${ORIGIN}/a`, HREF]]);
  });

  it('C6 跨網域視窗被忽略，改開新視窗', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, 'https://evil.com/inbox', { focused: true }), { url: 'not a url' }] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([]);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toEqual([['openWindow', HREF]]);
  });

  it('C7 通知資料被竄改：一律開首頁', async () => {
    for (const data of [null, undefined, { url: 'https://evil.com' }, { url: 123 }, { url: '/..//evil.com' }]) {
      const ctx = load();
      await click(ctx, data);
      expect(ctx.log.filter((x) => x[0] === 'openWindow'), JSON.stringify(data)).toEqual([['openWindow', `${ORIGIN}/`]]);
    }
  });

  it('C8 matchAll 拒絕、openWindow 拒絕：waitUntil 仍 resolve，監聽不丟錯', async () => {
    expect((await click(load({ matchAllReject: true }), { url: '/inbox' })).result).toBe('resolved');
    expect((await click(load({ openWindowReject: true }), { url: '/inbox' })).result).toBe('resolved');
    const ctx = load();
    expect(() => ctx.listeners.notificationclick({ notification: null, waitUntil() {} })).not.toThrow();
  });
});

describe('sw-push：建置設定', () => {
  it('S1 vite 設定匯入兩支、sw-push.js 不預存', async () => {
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain("importScripts: ['sw-legacy-compat.js', 'sw-push.js']");
    expect(config).toMatch(/globIgnores:[^\]]*'sw-push\.js'/);
  });
});
