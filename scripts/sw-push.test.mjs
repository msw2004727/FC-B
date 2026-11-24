// @vitest-environment node
/**
 * 網頁推播接收（W4，public/sw-push.js）：讀真檔、用假 self 執行。
 * 案例編號對照設計書 web-push-w4-sw-design-2026-11-24.md §5.1（P1～P11、C1～C8、S1）；
 * W4.1（點通知先問頁面）對照 web-push-w5-design-2026-11-24.md §6.3、§8.2（C2′～C2‴、C4′、C9～C11）。
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

/** 假 MessageChannel：port2.postMessage 以 microtask 送到 port1.onmessage（與真的一樣是非同步）。 */
const closedPorts = [];
class FakeChannel {
  constructor() {
    const port1 = { onmessage: null, closed: false, close: () => { port1.closed = true; closedPorts.push(port1); } };
    this.port1 = port1;
    this.port2 = {
      postMessage: (data) => {
        queueMicrotask(() => {
          if (port1.onmessage) port1.onmessage({ data });
        });
      },
    };
  }
}

/**
 * 假計時器。auto：setImmediate 觸發（在所有 microtask 之後，所以頁面的回覆一定先到）；
 * 非 auto：只登記，由測試呼叫 fire() 觸發。
 */
function fakeTimers(auto) {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false, fired: false };
      timers.push(t);
      if (auto) {
        setImmediate(() => {
          if (!t.cleared) {
            t.fired = true;
            fn();
          }
        });
      }
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    fire: () => {
      for (const t of timers) {
        if (!t.cleared && !t.fired) {
          t.fired = true;
          t.fn();
        }
      }
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** 假 self：記錄監聽、通知與視窗操作。rejectShow 為要拒絕的第幾次（1 起算）呼叫。 */
function load({ rejectShow = [], clients = [], matchAllReject = false, openWindowReject = false, channel = FakeChannel, autoTimer = true } = {}) {
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
  const timer = fakeTimers(autoTimer);
  new Function('self', 'MessageChannel', 'setTimeout', 'clearTimeout', source)(self, channel === 'none' ? undefined : channel, timer.setTimeout, timer.clearTimeout);
  return { listeners, added, shown, log, self, timer };
}

/**
 * 假視窗：focus 回自己，focus／navigate 可設定拒絕。
 * reply：頁面經 port 回的內容；undefined＝不回（舊頁面或監聽還沒載入），'throw'＝postMessage 丟錯。
 */
function fakeClient(log, url, { focused = false, visibilityState = 'hidden', navigateReject = false, navigateThrow = false, focusReject = false, reply } = {}) {
  const client = {
    url,
    focused,
    visibilityState,
    focus: () => {
      log.push(['focus', url]);
      return focusReject ? Promise.reject(new Error('not allowed')) : Promise.resolve(client);
    },
    postMessage: (msg, transfer) => {
      log.push(['postMessage', url, msg, transfer]);
      if (reply === 'throw') throw new Error('DataCloneError');
      if (reply !== undefined) transfer[0].postMessage(reply);
    },
    navigate: (href) => {
      log.push(['navigate', url, href]);
      if (navigateThrow) throw new TypeError('navigate is not supported');
      return navigateReject ? Promise.reject(new TypeError('not controlled')) : Promise.resolve(client);
    },
  };
  return client;
}

/** 點通知但不等結果，回傳 waitUntil 收到的 Promise（逾時測試用）。 */
function clickNoWait(ctx, data) {
  let pending = null;
  ctx.listeners.notificationclick({ notification: { data, close() {} }, waitUntil: (p) => { pending = p; } });
  return pending;
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
  // 路徑裡的反斜線會被 URL 正規化成 /，query 裡的不會：鎖住 badPath 的反斜線那一道。
  `/x?a${BS}b`,
  `/x#a${BS}b`,
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

  it('P3 靜態檢查：沒有禁用 API 與 ES2017 以後語法、可編譯、無 BOM、≤ 8,192 B', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const token of ['importScripts', 'fetch(', 'XMLHttpRequest', 'import(', 'caches', 'indexedDB', 'skipWaiting', 'clients.claim', '?.', '??', 'async ', 'await ', '...']) {
      expect(code.includes(token), token).toBe(false);
    }
    // W4.1 起允許 postMessage，但只准這一處：點通知時送給選中的受控分頁（不廣播、不帶通知內容）。
    expect(code.split('postMessage(')).toHaveLength(2);
    expect(code).toContain("client.postMessage({ type: 'toosterx:webpush-open', v: 1, path: path }, [ch.port2])");
    expect(() => new vm.Script(source)).not.toThrow();
    expect(source.charCodeAt(0)).not.toBe(0xfeff);
    // 上限 8 KiB：此檔不預存（vite.config.ts 的 globIgnores 排除 sw-push.js，見 S1）、不進入口，只在 SW 安裝與更新檢查時下載；
    // W4.1 加 askPage 後原始檔約 6 KB（多為中文註解，3 B／字），原 5,120 B 上限不夠。
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThanOrEqual(8192);
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

  it('P7b 解析結果不同源一律退回 /（多餘防線，以替身 URL 鎖住）', async () => {
    class TrapURL extends URL {
      get origin() {
        return this.pathname === '/trap' ? 'https://evil.com' : super.origin;
      }
    }
    const listeners = {};
    const shown = [];
    const self = {
      location: { origin: ORIGIN },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      registration: { showNotification: (t, o) => { shown.push([t, o]); return Promise.resolve(); } },
    };
    new Function('self', 'URL', source)(self, TrapURL);
    for (const url of ['/trap', '/inbox']) {
      let pending = null;
      listeners.push({ data: jsonData({ v: 1, title: 't', body: 'b', url }), waitUntil: (p) => { pending = p; } });
      await pending;
    }
    expect(shown.map((x) => x[1].data.url)).toEqual(['/', '/inbox']);
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
    expect(ctx.log).toEqual([['matchAll', { type: 'window', includeUncontrolled: false }], ['openWindow', HREF]]);
  });

  it('C4′ matchAll 只找受控分頁（includeUncontrolled: false），每種情況都一樣', async () => {
    const cases = [[], [fakeClient([], HREF)], [fakeClient([], `${ORIGIN}/events`, { reply: { v: 1, result: 'routed' } })], [fakeClient([], `${ORIGIN}/events`)]];
    for (const clients of cases) {
      const ctx = load({ clients });
      await click(ctx, { url: '/inbox' });
      const calls = ctx.log.filter((x) => x[0] === 'matchAll');
      expect(calls).toEqual([['matchAll', { type: 'window', includeUncontrolled: false }]]);
      expect(calls[0][1].includeUncontrolled).toBe(false);
    }
  });

  it('C2 有受控分頁在別頁、頁面沒回（舊頁面）：focus、問頁面，逾時後 navigate，不開新窗', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`)] });
    await click(ctx, { url: '/inbox' });
    expect(log.map((x) => x.slice(0, 3))).toEqual([
      ['focus', `${ORIGIN}/events`],
      ['postMessage', `${ORIGIN}/events`, { type: 'toosterx:webpush-open', v: 1, path: '/inbox' }],
      ['navigate', `${ORIGIN}/events`, HREF],
    ]);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
  });

  it('C2′ 頁面回 routed（已站內切頁）：focus、postMessage，沒有 navigate、沒有 openWindow', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`, { reply: { v: 1, result: 'routed' } })] });
    const r = await click(ctx, { url: '/inbox' });
    expect(r.result).toBe('resolved');
    expect(log.map((x) => x.slice(0, 3))).toEqual([
      ['focus', `${ORIGIN}/events`],
      ['postMessage', `${ORIGIN}/events`, { type: 'toosterx:webpush-open', v: 1, path: '/inbox' }],
    ]);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
    expect(ctx.timer.timers).toHaveLength(1);
    expect(ctx.timer.timers[0].cleared).toBe(true);
  });

  it('C2″ 頁面回 kept（留在原頁）：focus、postMessage，沒有 navigate、沒有 openWindow', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events/new`, { reply: { v: 1, result: 'kept' } })] });
    const r = await click(ctx, { url: '/inbox' });
    expect(r.result).toBe('resolved');
    expect(log.map((x) => x[0])).toEqual(['focus', 'postMessage']);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
    expect(ctx.timer.timers[0].cleared).toBe(true);
  });

  it('C2‴ 頁面 1 秒內沒回：計時器 1000 ms 到了才 navigate', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`)], autoTimer: false });
    const pending = clickNoWait(ctx, { url: '/inbox' });
    let settled = false;
    pending.then(() => { settled = true; });
    await tick();
    expect(log.map((x) => x[0])).toEqual(['focus', 'postMessage']);
    expect(settled).toBe(false);
    expect(ctx.timer.timers.map((t) => t.ms)).toEqual([1000]);
    ctx.timer.fire();
    await pending;
    expect(log.map((x) => x[0])).toEqual(['focus', 'postMessage', 'navigate']);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
  });

  it('C2a 回覆格式不對（版本、結果、空值）：當成沒處理，navigate', async () => {
    for (const reply of [{ v: 2, result: 'routed' }, { v: 1, result: 'ok' }, { result: 'kept' }, null, 'routed']) {
      const log = [];
      closedPorts.length = 0;
      const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`, { reply })] });
      await click(ctx, { url: '/inbox' });
      expect(log.map((x) => x[0]), JSON.stringify(reply)).toEqual(['focus', 'postMessage', 'navigate']);
      expect(closedPorts, JSON.stringify(reply)).toHaveLength(1);
      expect(ctx.timer.timers.every((t) => t.cleared), JSON.stringify(reply)).toBe(true);
    }
  });

  it('C2b 逾時後才到的回覆不改結果（只 navigate 一次）', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`)], autoTimer: false });
    const pending = clickNoWait(ctx, { url: '/inbox' });
    await tick();
    ctx.timer.fire();
    await pending;
    log.find((x) => x[0] === 'postMessage')[3][0].postMessage({ v: 1, result: 'routed' });
    await tick();
    expect(log.map((x) => x[0])).toEqual(['focus', 'postMessage', 'navigate']);
  });

  it('C3 已有視窗就在該頁：只 focus，不問頁面', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, HREF, { reply: { v: 1, result: 'routed' } })] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', HREF]]);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
    expect(ctx.timer.timers).toHaveLength(0);
  });

  it('C4 navigate 被拒：最後一搏改開新視窗；openWindow 也被拒時 waitUntil 仍 resolve', async () => {
    const log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`, { navigateReject: true })] });
    const r = await click(ctx, { url: '/inbox' });
    expect(r.result).toBe('resolved');
    expect(log.map((x) => x[0])).toEqual(['focus', 'postMessage', 'navigate']);
    expect(ctx.log.filter((x) => x[0] === 'openWindow')).toEqual([['openWindow', HREF]]);
    const both = load({ clients: [fakeClient([], `${ORIGIN}/events`, { navigateReject: true })], openWindowReject: true });
    expect((await click(both, { url: '/inbox' })).result).toBe('resolved');
    expect(both.log.filter((x) => x[0] === 'openWindow')).toEqual([['openWindow', HREF]]);
    // navigate 同步丟錯（不是回傳被拒的 Promise）也要最後一搏開新視窗
    const syncLog = [];
    const sync = load({ clients: [fakeClient(syncLog, `${ORIGIN}/events`, { navigateThrow: true })] });
    expect((await click(sync, { url: '/inbox' })).result).toBe('resolved');
    expect(syncLog.map((x) => x[0])).toEqual(['focus', 'postMessage', 'navigate']);
    expect(sync.log.filter((x) => x[0] === 'openWindow')).toEqual([['openWindow', HREF]]);
  });

  it('C12 askPage 結束一律關 port：回覆、逾時、postMessage 丟錯三條路徑', async () => {
    const portOf = (log) => log.find((x) => x[0] === 'postMessage')[3];
    // 回覆
    closedPorts.length = 0;
    let log = [];
    await click(load({ clients: [fakeClient(log, `${ORIGIN}/events`, { reply: { v: 1, result: 'kept' } })] }), { url: '/inbox' });
    expect(closedPorts).toHaveLength(1);
    // 逾時
    closedPorts.length = 0;
    log = [];
    const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`)], autoTimer: false });
    const pending = clickNoWait(ctx, { url: '/inbox' });
    await tick();
    expect(closedPorts).toHaveLength(0);
    ctx.timer.fire();
    await pending;
    expect(closedPorts).toHaveLength(1);
    expect(portOf(log)).toHaveLength(1);
    // postMessage 丟錯
    closedPorts.length = 0;
    log = [];
    await click(load({ clients: [fakeClient(log, `${ORIGIN}/events`, { reply: 'throw' })] }), { url: '/inbox' });
    expect(closedPorts).toHaveLength(1);
    // port1.close 丟錯也不影響結果
    class ThrowClose extends FakeChannel {
      constructor() {
        super();
        this.port1.close = () => { throw new Error('closed'); };
      }
    }
    log = [];
    await click(load({ clients: [fakeClient(log, `${ORIGIN}/events`, { reply: { v: 1, result: 'routed' } })], channel: ThrowClose }), { url: '/inbox' });
    expect(log.map((x) => x[0])).toEqual(['focus', 'postMessage']);
  });

  it('C9 focus 被拒：改開新視窗，不問頁面、不 navigate', async () => {
    for (const url of [`${ORIGIN}/events`, HREF]) {
      const log = [];
      const ctx = load({ clients: [fakeClient(log, url, { focusReject: true, reply: { v: 1, result: 'routed' } })] });
      const r = await click(ctx, { url: '/inbox' });
      expect(r.result).toBe('resolved');
      expect(log, url).toEqual([['focus', url]]);
      expect(ctx.log.filter((x) => x[0] === 'openWindow'), url).toEqual([['openWindow', HREF]]);
    }
    // focus 被拒、openWindow 也被拒：waitUntil 仍 resolve。
    const ctx = load({ clients: [fakeClient([], `${ORIGIN}/events`, { focusReject: true })], openWindowReject: true });
    expect((await click(ctx, { url: '/inbox' })).result).toBe('resolved');
  });

  it('C10 沒有 MessageChannel、建構丟錯、postMessage 丟錯：直接 navigate，不等計時器', async () => {
    const broken = [
      { channel: 'none' },
      { channel: class { constructor() { throw new Error('no'); } } },
      { channel: FakeChannel, reply: 'throw' },
    ];
    for (const b of broken) {
      const log = [];
      const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/events`, { reply: b.reply })], channel: b.channel, autoTimer: false });
      const r = await click(ctx, { url: '/inbox' });
      expect(r.result).toBe('resolved');
      expect(log[log.length - 1]).toEqual(['navigate', `${ORIGIN}/events`, HREF]);
      expect(ctx.timer.timers.every((t) => t.cleared)).toBe(true);
      expect(ctx.log.filter((x) => x[0] === 'openWindow')).toHaveLength(0);
    }
  });

  it('C11 訊息只有 type、v、path，path 是 safePath 的結果，port 恰好一個', async () => {
    const cases = [
      [{ url: '/events/abc?x=1#y' }, '/events/abc?x=1#y'],
      [{ url: 'https://evil.com/x' }, '/'],
      [{ url: '/..//evil.com' }, '/'],
      [{ url: 123 }, '/'],
    ];
    for (const [data, path] of cases) {
      const log = [];
      const ctx = load({ clients: [fakeClient(log, `${ORIGIN}/other`, { reply: { v: 1, result: 'routed' } })] });
      await click(ctx, data);
      const [, , msg, ports] = log.find((x) => x[0] === 'postMessage');
      expect(Object.keys(msg), JSON.stringify(data)).toEqual(['type', 'v', 'path']);
      expect(msg).toEqual({ type: 'toosterx:webpush-open', v: 1, path });
      expect(ports).toHaveLength(1);
    }
  });

  it('C5 多個視窗：網址完全相同 > focused／visible > 第一個', async () => {
    let log = [];
    let ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/b`, { visibilityState: 'visible' }), fakeClient(log, HREF)] });
    await click(ctx, { url: '/inbox' });
    expect(log).toEqual([['focus', HREF]]);

    log = [];
    ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/b`, { visibilityState: 'visible' })] });
    await click(ctx, { url: '/inbox' });
    expect(log.filter((x) => x[0] !== 'postMessage')).toEqual([['focus', `${ORIGIN}/b`], ['navigate', `${ORIGIN}/b`, HREF]]);

    log = [];
    ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/c`, { focused: true })] });
    await click(ctx, { url: '/inbox' });
    expect(log.filter((x) => x[0] !== 'postMessage')).toEqual([['focus', `${ORIGIN}/c`], ['navigate', `${ORIGIN}/c`, HREF]]);

    log = [];
    ctx = load({ clients: [fakeClient(log, `${ORIGIN}/a`), fakeClient(log, `${ORIGIN}/b`)] });
    await click(ctx, { url: '/inbox' });
    expect(log.filter((x) => x[0] !== 'postMessage')).toEqual([['focus', `${ORIGIN}/a`], ['navigate', `${ORIGIN}/a`, HREF]]);
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
