import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import {
  BANNERS_REST_MAX_BYTES,
  BANNERS_REST_TIMEOUT_MS,
  bannersRestBody,
  bannersRestUrl,
  parseRunQueryResponse,
} from '@/features/home/data/banners-rest';
import { EXCLUDED_KEYS, EXCLUDED_TYPES } from '@/features/home/data/banners';
import { canUseBannersRest } from '@/features/home/data/banners-rest-guard';
import {
  BANNERS_SNAPSHOT_KEY,
  HOME_SNAPSHOT_MAX_AGE_MS,
  HOME_SNAPSHOT_MAX_CHARS,
  _clearHomeSnapshotForTest,
  readBannersSnapshot,
  toPublicBanners,
  writeBannersSnapshot,
} from '@/features/home/data/home-snapshot';
import {
  fakeResponse,
  jsonResponse,
  restActiveFields,
  restDoc,
  restDocName,
  restEmptyMarker,
  restStr,
  splitBytes,
} from '@/features/home/data/__fixtures__/banners-rest';
import { APP_VERSION } from '@/version';
import {
  EARLY_BANNERS_PROJECT_TOKEN,
  EARLY_BANNERS_SCRIPT_ID,
  EARLY_BANNERS_VERSION_TOKEN,
  earlyBannersHtml,
  transformEarlyBannersHtml,
} from '../../scripts/early-banners-html';

// T-042d：index.html 的內嵌 script（#fcb-early-banners）——HTML 一到就發匿名 REST、預載第一張橫幅圖。
// 這個檔案把「建置後的 script」放進 node:vm 沙盒實際執行（假的 location／localStorage／fetch／document），不連網、不碰真的 DOM。
// 鎖定的契約：
// 1. 發不發的條件與 canUseBannersRest()＋readBannersSnapshot() 一致（兩份判斷任何一邊改動這裡都會紅）；
// 2. 請求內容與 banners-rest.ts 一致（網址含 projectId、body、無憑證、4 秒逾時、256 KB 上限）；
// 3. 只做「發請求」與「插一個 preload link」兩件事；preload 網址只放行 https＋白名單主機；
// 4. 建置外掛的代號替換與 emulator 移除。

// 與 vite.config.ts／data/firebase.ts 的 PROD 差異無關：這裡固定「非 emulator」，emulator 另測外掛移除。
vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  shouldUseEmulator: () => false,
}));

const ROOT = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const rawHtml = read('index.html');
const viteConfig = read('vite.config.ts');

function buildHtml(emulator = false): string {
  return transformEarlyBannersHtml(rawHtml, { projectId: FIREBASE_CONFIG.projectId, appVersion: APP_VERSION, emulator });
}

/** 建置後內嵌 script 的程式碼（代號已換成真值）。 */
function builtScript(): string {
  const m = /<script id="fcb-early-banners">([\s\S]*?)<\/script>/.exec(buildHtml());
  if (!m?.[1]) throw new Error('找不到內嵌 script');
  return m[1];
}
const rawScript = /<script id="fcb-early-banners">([\s\S]*?)<\/script>/.exec(rawHtml)?.[1] ?? '';

// ── 沙盒 ──────────────────────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 9, 27, 4, 0, 0);
const GOOD_IMAGE = 'https://firebasestorage.googleapis.com/v0/b/b/o/hero.webp?alt=media&token=t';

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
interface FakeLink {
  attrs: Record<string, string>;
}
interface RunOptions {
  hostname?: string;
  pathname?: string;
  search?: string;
  origin?: string;
  /** 不給＝沙盒沒有 fetch；給了就用它。預設永遠等不到回應。 */
  fetch?: FetchImpl | null;
  noAbortController?: boolean;
  storage?: Pick<Storage, 'getItem'>;
}
interface Timer {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

const hanging: FetchImpl = () => new Promise<Response>(() => undefined);

function run(options: RunOptions = {}) {
  const links: FakeLink[] = [];
  const created: string[] = [];
  const timers: Timer[] = [];
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const consoleCalls: string[] = [];
  const fetchImpl = options.fetch === undefined ? hanging : options.fetch;
  const sandbox: Record<string, unknown> = {
    // vm 沙盒的 console 預設是 V8 內建、不走宿主的 spy，所以自己傳一個替身：script 呼叫任何 console 方法都會被記下來。
    console: new Proxy({}, { get: (_target, name) => () => void consoleCalls.push(String(name)) }),
    location: {
      hostname: options.hostname ?? 'toosterx.com',
      pathname: options.pathname ?? '/',
      search: options.search ?? '',
      origin: options.origin ?? 'https://toosterx.com',
    },
    localStorage: options.storage ?? globalThis.localStorage,
    Date: { now: () => NOW },
    setTimeout: (fn: () => void, ms: number): number => {
      timers.push({ fn, ms, cleared: false });
      return timers.length;
    },
    clearTimeout: (id: number): void => {
      const timer = timers[id - 1];
      if (timer) timer.cleared = true;
    },
    TextDecoder,
    TextEncoder,
    URL,
    document: {
      createElement: (tag: string): FakeLink => {
        created.push(tag);
        const link: FakeLink = { attrs: {} };
        return Object.assign(link, {
          setAttribute: (name: string, value: string) => {
            link.attrs[name] = value;
          },
        });
      },
      head: { appendChild: (el: FakeLink) => links.push(el) },
    },
  };
  if (!options.noAbortController) sandbox.AbortController = AbortController;
  if (fetchImpl) {
    sandbox.fetch = (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    };
  }
  sandbox.window = sandbox;
  runInNewContext(builtScript(), sandbox);
  return {
    links,
    created,
    timers,
    fetchCalls,
    consoleCalls,
    fired: fetchCalls.length > 0,
    /** window.__fcbEarlyBanners（沒發＝undefined）。 */
    early: sandbox.__fcbEarlyBanners as Promise<unknown> | undefined,
  };
}

const okFetch =
  (payload: unknown): FetchImpl =>
  async () =>
    jsonResponse(payload).response;
const bannerDoc = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  restDoc(id, restActiveFields({ title: restStr(id), ...extra }));
const withImage = (id: string, image: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  bannerDoc(id, { image: restStr(image), ...extra });
const json = (value: unknown): string => JSON.stringify(value);

beforeEach(() => {
  _clearHomeSnapshotForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _clearHomeSnapshotForTest();
});

// ── 1. 發不發：與 canUseBannersRest()＋快照判斷一致 ─────────────────────────────────────────

const HOSTS = [
  'toosterx.com',
  'next.toosterx.com',
  'www.toosterx.com',
  'localhost',
  'LOCALHOST',
  '  localhost  ',
  'localhost.com',
  '127.0.0.1',
  '127.0.0.2',
  '::1',
  '[::1]',
  '0.0.0.0',
  'app.localhost',
  'a.b.localhost',
  'mac.local',
  'printer.local',
  'notlocal',
  'xlocal',
  'local',
  '.local',
  '10.0.0.1',
  '10.255.255.255',
  '10.1.2',
  '10.1.2.3.4',
  '9.255.255.255',
  '11.0.0.1',
  '192.168.0.1',
  '192.168.255.255',
  '192.167.0.1',
  '192.169.0.1',
  '192.168.1',
  '172.015.0.1',
  '1.2.3.4',
  // IPv6 link-local／ULA 與尾端有點的 localhost：目前 TS 與 script 都視為「不是本機」（既有缺口，早期 script 照搬）；
  // 之後若只改其中一邊（例如 isLocalOrPrivateHostname 開始擋它們），這幾列會紅，提醒兩邊一起改。
  '[fe80::1]',
  '[fd00::1]',
  'fe80::1',
  'fd00::1',
  'localhost.',
  'LOCALHOST.',
  ...Array.from({ length: 40 }, (_, n) => `172.${n}.0.1`),
  '',
];

describe('內嵌 script：連線目標條件與 canUseBannersRest() 一致', () => {
  it.each(HOSTS)('hostname %j', (hostname) => {
    expect(run({ hostname }).fired).toBe(canUseBannersRest(hostname));
  });

  it('站內正式網址會發、本機與私有網址不發（防兩邊同時壞掉的對照）', () => {
    expect(run({ hostname: 'toosterx.com' }).fired).toBe(true);
    expect(run({ hostname: 'localhost' }).fired).toBe(false);
    expect(run({ hostname: '192.168.1.20' }).fired).toBe(false);
  });
});

const itemOk = { id: 'b1', _docId: 'b1', status: 'active', title: 't', image: GOOD_IMAGE };

function sectionJson(over: Record<string, unknown> = {}, items: unknown[] = [itemOk]): string {
  return JSON.stringify({ v: 1, appVersion: APP_VERSION, savedAt: NOW - 1000, items, ...over });
}
/** 剛好 HOME_SNAPSHOT_MAX_CHARS（或指定長度）字元的有效快照 JSON（用標題欄位補長；標題超長只會被投影丟掉，橫幅仍有效）。 */
function sectionOfLength(length: number): string {
  const base = JSON.stringify({ v: 1, appVersion: APP_VERSION, savedAt: NOW - 1000, items: [{ ...itemOk, title: '' }] });
  return JSON.stringify({ v: 1, appVersion: APP_VERSION, savedAt: NOW - 1000, items: [{ ...itemOk, title: 'x'.repeat(length - base.length) }] });
}

interface SnapshotCase {
  name: string;
  raw: string | null;
  /** 內嵌 script 比 readBannersSnapshot() 更保守：快照結構有效但投影後沒有任何橫幅 → script 不發、HomePage 自發。 */
  conservative?: boolean;
}
const SNAPSHOT_CASES: SnapshotCase[] = [
  { name: '沒有快照', raw: null },
  { name: '有效快照', raw: sectionJson() },
  { name: '寫入 30 分鐘整（邊界，仍有效）', raw: sectionJson({ savedAt: NOW - HOME_SNAPSHOT_MAX_AGE_MS }) },
  { name: '超過 30 分鐘 1 毫秒（過期）', raw: sectionJson({ savedAt: NOW - HOME_SNAPSHOT_MAX_AGE_MS - 1 }) },
  { name: '寫入時間比現在晚 60 秒整（邊界，仍有效）', raw: sectionJson({ savedAt: NOW + 60_000 }) },
  { name: '寫入時間比現在晚超過 60 秒（不可信）', raw: sectionJson({ savedAt: NOW + 60_001 }) },
  { name: '版號不同（部署後的舊快照）', raw: sectionJson({ appVersion: '0.19990101' }) },
  { name: '版號缺少', raw: sectionJson({ appVersion: undefined }) },
  { name: 'v 不是 1', raw: sectionJson({ v: 2 }) },
  { name: 'savedAt 是字串', raw: sectionJson({ savedAt: String(NOW) }) },
  { name: 'savedAt 是 null', raw: sectionJson({ savedAt: null }) },
  { name: 'items 是空陣列', raw: sectionJson({}, []) },
  { name: 'items 不是陣列', raw: sectionJson({ items: 'x' }) },
  { name: '不是 JSON', raw: '{oops' },
  { name: 'JSON null', raw: 'null' },
  { name: 'JSON 陣列', raw: '[]' },
  { name: 'JSON 空字串', raw: '""' },
  { name: 'JSON 數字', raw: '0' },
  { name: '剛好上限字數（仍有效）', raw: sectionOfLength(HOME_SNAPSHOT_MAX_CHARS) },
  { name: '超過上限 1 字元', raw: sectionOfLength(HOME_SNAPSHOT_MAX_CHARS + 1) },
  { name: '快照結構有效但橫幅全不合格（投影後為空）', raw: sectionJson({}, [{ id: 'x' }, { id: 'y', _docId: 'y', status: 'inactive' }]), conservative: true },
];

describe('內嵌 script：首屏快照條件與 readBannersSnapshot() 一致', () => {
  it.each(SNAPSHOT_CASES)('$name', ({ raw, conservative }) => {
    if (raw !== null) localStorage.setItem(BANNERS_SNAPSHOT_KEY, raw);
    const homePageWouldFetch = readBannersSnapshot(NOW) === null && canUseBannersRest('toosterx.com');
    const fired = run().fired;
    // 安全方向：內嵌 script 絕不在「HomePage 不會發」的情況下發。
    if (fired) expect(homePageWouldFetch).toBe(true);
    // 其餘必須完全一致；唯一允許的差異是已文件化的保守案例（script 不發，HomePage 會自發）。
    expect(fired).toBe(conservative ? false : homePageWouldFetch);
    if (conservative) expect(homePageWouldFetch).toBe(true);
  });

  it('真的用 writeBannersSnapshot 寫出來的快照：有效時不發，清掉後發', () => {
    writeBannersSnapshot(toPublicBanners([{ id: 'b1', _docId: 'b1', status: 'active', image: GOOD_IMAGE }]), NOW - 5000);
    expect(readBannersSnapshot(NOW)).not.toBeNull();
    expect(run().fired).toBe(false);
    _clearHomeSnapshotForTest();
    expect(run().fired).toBe(true);
  });

  it('快照 key 與 home-snapshot.ts 一致（寫在 script 裡的字串）', () => {
    expect(rawScript).toContain(`localStorage.getItem('${BANNERS_SNAPSHOT_KEY}')`);
    expect(rawScript).toContain(`s.length <= ${HOME_SNAPSHOT_MAX_CHARS}`);
    expect(rawScript).toContain(`t - s.savedAt <= ${HOME_SNAPSHOT_MAX_AGE_MS}`);
  });

  it('讀取 localStorage 丟錯（私密模式、被停用）：和 readBannersSnapshot() 一樣當作沒有快照，仍然發', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    expect(readBannersSnapshot(NOW)).toBeNull();
    expect(run({ storage: throwing }).fired).toBe(true);
  });
});

describe('內嵌 script：只在首頁網址發（比 canUseBannersRest() 更保守）', () => {
  it.each([
    ['/events/abc', ''],
    ['/activities', ''],
    ['/index.html', ''],
    ['/', '?event=abc123'],
    ['/', '?team=t1'],
    ['/', '?liff.state=%2Fevents%2Fabc'],
    ['/', '?utm_source=line'],
  ])('路徑 %s 查詢 %j 不發（這些網址 App 可能導去別頁，白發一次請求與圖片會搶頻寬）', (pathname, search) => {
    expect(run({ pathname, search }).fired).toBe(false);
  });

  it('首頁 / 且沒有查詢字串才發', () => {
    expect(run({ pathname: '/', search: '' }).fired).toBe(true);
  });

  it('沙盒沒有 fetch、沒有 AbortController：不發、不丟錯、不留全域', () => {
    const a = run({ fetch: null });
    expect(a.fired).toBe(false);
    expect(a.early).toBeUndefined();
    const b = run({ noAbortController: true });
    expect(b.fired).toBe(false);
    expect(b.early).toBeUndefined();
  });

  it('fetch 同步丟錯：吞掉、不留全域（HomePage 之後自發）', () => {
    const r = run({
      fetch: () => {
        throw new Error('sync');
      },
    });
    expect(r.early).toBeUndefined();
  });
});

// ── 2. 請求內容 ───────────────────────────────────────────────────────────────────────────

describe('內嵌 script：請求內容與 banners-rest.ts 一致', () => {
  it('網址（projectId 與 FIREBASE_CONFIG 一致）、body、無憑證、簡單請求', () => {
    const r = run();
    expect(r.fetchCalls).toHaveLength(1);
    const { url, init } = r.fetchCalls[0] ?? { url: '', init: {} };
    expect(url).toBe(bannersRestUrl());
    expect(url).toContain(`/projects/${FIREBASE_CONFIG.projectId}/`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(bannersRestBody());
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(Object.keys(init).sort()).toEqual(['body', 'credentials', 'headers', 'method', 'signal']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const serialized = JSON.stringify([url, init]);
    expect(serialized).not.toContain(FIREBASE_CONFIG.apiKey);
    expect(serialized).not.toMatch(/[?&]key=|authorization|x-goog-api-key|cookie/i);
  });

  it('script 內沒有寫死的 projectId／版號／apiKey，代號各只出現一次', () => {
    for (const literal of [FIREBASE_CONFIG.projectId, FIREBASE_CONFIG.apiKey, APP_VERSION]) {
      expect(rawScript).not.toContain(literal);
    }
    expect(rawScript.split(EARLY_BANNERS_PROJECT_TOKEN)).toHaveLength(2);
    expect(rawScript.split(EARLY_BANNERS_VERSION_TOKEN)).toHaveLength(2);
    expect(builtScript()).toContain(FIREBASE_CONFIG.projectId);
    expect(builtScript()).not.toMatch(/__FCB_/);
  });

  it('只發一次請求，全域 Promise 掛在 window.__fcbEarlyBanners', () => {
    const r = run();
    expect(r.fetchCalls).toHaveLength(1);
    expect(r.early).toBeInstanceOf(Promise);
  });

  it('4 秒逾時：計時器毫秒數與 BANNERS_REST_TIMEOUT_MS 一致，到時中止請求並 resolve null', async () => {
    const r = run({
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    });
    expect(r.timers).toHaveLength(1);
    expect(r.timers[0]?.ms).toBe(BANNERS_REST_TIMEOUT_MS);
    expect(r.fetchCalls[0]?.init.signal?.aborted).toBe(false);
    r.timers[0]?.fn();
    expect(r.fetchCalls[0]?.init.signal?.aborted).toBe(true);
    await expect(r.early).resolves.toBeNull();
    expect(r.timers[0]?.cleared).toBe(true);
  });

  it('成功回應後清掉逾時計時器', async () => {
    const r = run({ fetch: okFetch([restEmptyMarker()]) });
    await r.early;
    expect(r.timers[0]?.cleared).toBe(true);
  });
});

// ── 3. 回應處理：原始 payload 或 null ───────────────────────────────────────────────────────

describe('內嵌 script：resolve 原始回應（不映射）或 null，絕不 reject', () => {
  it('成功：resolve 的是伺服器回應解析後的原樣內容（沒有任何映射或欄位刪減）', async () => {
    const payload = [bannerDoc('b1', { uid: restStr('secret-uid'), extra: restStr('x') }), restEmptyMarker()];
    const r = run({ fetch: okFetch(payload) });
    expect(json(await r.early)).toBe(json(payload));
  });

  it('空結果標記陣列也原樣回傳', async () => {
    const payload = [restEmptyMarker()];
    expect(json(await run({ fetch: okFetch(payload) }).early)).toBe(json(payload));
  });

  it('含 error 元素的陣列原樣回傳（交給 HomePage 的 parseRunQueryResponse 判斷成 null），但不預載', async () => {
    const payload = [withImage('b1', GOOD_IMAGE), { error: { code: 403 } }];
    const r = run({ fetch: okFetch(payload) });
    expect(json(await r.early)).toBe(json(payload));
    expect(parseRunQueryResponse(payload)).toBeNull();
    expect(r.links).toHaveLength(0);
  });

  it.each([
    ['網路錯誤', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['HTTP 500', async () => jsonResponse([], { status: 500 }).response],
    ['HTTP 403', async () => jsonResponse([{ error: { code: 403 } }], { status: 403 }).response],
    ['JSON 損毀', async () => fakeResponse('[{"document":').response],
    ['空回應', async () => fakeResponse('').response],
    ['回應不是陣列（物件）', async () => jsonResponse({ documents: [] }).response],
    ['回應不是陣列（字串）', async () => jsonResponse('x').response],
    ['回應是 null', async () => jsonResponse(null).response],
  ])('失敗（%s）：resolve null、不 reject、沒有預載', async (_name, respond) => {
    const r = run({ fetch: respond as FetchImpl });
    await expect(r.early).resolves.toBeNull();
    expect(r.links).toHaveLength(0);
  });

  it('宣告的 Content-Length 超過 256 KB：不讀本文、resolve null', async () => {
    const handle = jsonResponse([], { headers: { 'Content-Length': String(BANNERS_REST_MAX_BYTES + 1) } });
    await expect(run({ fetch: async () => handle.response }).early).resolves.toBeNull();
    expect(handle.read).not.toHaveBeenCalled();
  });

  it('串流讀到超過 256 KB：取消讀取、resolve null；剛好 256 KB 可以', async () => {
    const pad = (n: number): Uint8Array => new TextEncoder().encode(`[${' '.repeat(n - 2)}]`);
    const over = fakeResponse(splitBytes(pad(BANNERS_REST_MAX_BYTES + 1), 64 * 1024));
    await expect(run({ fetch: async () => over.response }).early).resolves.toBeNull();
    expect(over.cancel).toHaveBeenCalledTimes(1);
    const exact = fakeResponse(splitBytes(pad(BANNERS_REST_MAX_BYTES), 64 * 1024));
    expect(json(await run({ fetch: async () => exact.response }).early)).toBe('[]');
    expect(exact.cancel).not.toHaveBeenCalled();
  });

  it('沒有串流介面時走 text()：超過 256 KB 回 null，沒超過可以', async () => {
    const over = fakeResponse(`[${' '.repeat(BANNERS_REST_MAX_BYTES)}]`, { noStream: true });
    await expect(run({ fetch: async () => over.response }).early).resolves.toBeNull();
    const ok = fakeResponse(json([restEmptyMarker()]), { noStream: true });
    expect(json(await run({ fetch: async () => ok.response }).early)).toBe(json([restEmptyMarker()]));
  });

  // 256 KB 上限與非 2xx 不只是「不解析」：結果一確定就中止請求，瀏覽器才不會繼續在背景把本文收進緩衝區（對照 T-042c banners-rest.ts 的 finally abort）。
  const ABORT_CASES: Array<[string, () => FetchImpl]> = [
    ['非 2xx', () => async () => jsonResponse([], { status: 500 }).response],
    ['宣告的 Content-Length 超過 256 KB', () => async () => jsonResponse([], { headers: { 'Content-Length': String(BANNERS_REST_MAX_BYTES + 1) } }).response],
    ['串流讀到超過 256 KB', () => async () => fakeResponse(splitBytes(new TextEncoder().encode(`[${' '.repeat(BANNERS_REST_MAX_BYTES)}]`), 64 * 1024)).response],
    ['成功（本文已讀完，abort 等同沒動作）', () => okFetch([restEmptyMarker()])],
    ['回應不是 JSON', () => async () => fakeResponse('<html>').response],
  ];
  it.each(ABORT_CASES)('結果確定後中止請求：%s', async (_name, make) => {
    const r = run({ fetch: make() });
    const signal = r.fetchCalls[0]?.init.signal;
    expect(signal?.aborted).toBe(false); // 結果出來之前不中止
    await r.early;
    expect(signal?.aborted).toBe(true);
  });

  it('成功時中止請求不影響回傳的內容', async () => {
    const payload = [withImage('b1', GOOD_IMAGE)];
    const r = run({ fetch: okFetch(payload) });
    const result = await r.early;
    expect(r.fetchCalls[0]?.init.signal?.aborted).toBe(true);
    expect(json(result)).toBe(json(payload));
    expect(r.links).toHaveLength(1);
  });

  it('沒有串流介面時 256 KB 上限量的是位元組不是字數：字數沒超過但位元組超過 → null；位元組沒超過 → 可以', async () => {
    // 「中」UTF-8 三個位元組：90000 個字＝約 270 KB（字數遠小於上限），87000 個字＝約 261 KB（剛好在上限內）。
    const over = fakeResponse(`["${'中'.repeat(90_000)}"]`, { noStream: true });
    await expect(run({ fetch: async () => over.response }).early).resolves.toBeNull();
    const fits = `["${'中'.repeat(87_000)}"]`;
    expect(new TextEncoder().encode(fits).length).toBeLessThanOrEqual(BANNERS_REST_MAX_BYTES);
    const ok = fakeResponse(fits, { noStream: true });
    expect(json(await run({ fetch: async () => ok.response }).early)).toBe(fits);
  });

  it('多位元組字元被切在 chunk 中間也能還原', async () => {
    const payload = [bannerDoc('b1', { subtitle: restStr('臺北市大安區運動中心「週末揪團」🏀') })];
    const bytes = new TextEncoder().encode(json(payload));
    const r = run({ fetch: async () => fakeResponse(splitBytes(bytes, 7)).response });
    expect(json(await r.early)).toBe(json(payload));
  });
});

// ── 4. preload：只做一個 link，網址通過最小檢查 ────────────────────────────────────────────────

describe('內嵌 script：第一張橫幅圖 preload', () => {
  async function preloadFor(image: string | undefined, origin = 'https://toosterx.com'): Promise<FakeLink[]> {
    const doc = image === undefined ? bannerDoc('b1') : withImage('b1', image);
    const r = run({ origin, fetch: okFetch([doc]) });
    await r.early;
    return r.links;
  }

  it('放行：firebasestorage 的 https 網址 → 恰好一個 link，屬性與輪播自己插的 preload 完全相同', async () => {
    const r = run({ fetch: okFetch([withImage('b1', GOOD_IMAGE), withImage('b2', 'https://firebasestorage.googleapis.com/second.webp')]) });
    await r.early;
    expect(r.created).toEqual(['link']);
    expect(r.links).toHaveLength(1);
    expect(r.links[0]?.attrs).toEqual({ rel: 'preload', as: 'image', fetchpriority: 'high', href: GOOD_IMAGE });
  });

  it.each([
    ['firebasestorage（含查詢字串）', GOOD_IMAGE, GOOD_IMAGE],
    ['站內同源 https', 'https://toosterx.com/img/hero.webp', 'https://toosterx.com/img/hero.webp'],
    ['前後空白會修剪（與輪播的 sanitizeHttpUrl 一致）', `  ${GOOD_IMAGE}\n`, GOOD_IMAGE],
    ['協定與主機大小寫不同', 'HTTPS://FIREBASESTORAGE.GOOGLEAPIS.COM/a.png', 'HTTPS://FIREBASESTORAGE.GOOGLEAPIS.COM/a.png'],
  ])('放行：%s', async (_name, image, expectedHref) => {
    const links = await preloadFor(image);
    expect(links).toHaveLength(1);
    expect(links[0]?.attrs.href).toBe(expectedHref);
  });

  it.each([
    ['http（非 https）', 'http://firebasestorage.googleapis.com/a.png'],
    ['同源 http', 'http://toosterx.com/a.png'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['blob:', 'blob:https://toosterx.com/1234'],
    ['ftp:', 'ftp://firebasestorage.googleapis.com/a.png'],
    ['協定相對（//）', '//firebasestorage.googleapis.com/a.png'],
    ['沒有雙斜線', 'https:firebasestorage.googleapis.com/a.png'],
    ['反斜線', 'https:\\\\firebasestorage.googleapis.com\\a.png'],
    ['相對路徑', '/img/hero.webp'],
    ['純檔名', 'hero.webp'],
    ['其他主機', 'https://evil.example/a.png'],
    ['storage.googleapis.com（不在白名單）', 'https://storage.googleapis.com/b/a.png'],
    ['白名單主機的子網域', 'https://sub.firebasestorage.googleapis.com/a.png'],
    ['白名單主機當前綴的惡意主機', 'https://firebasestorage.googleapis.com.evil.example/a.png'],
    ['白名單主機放在 @ 前面（實際主機是 evil）', 'https://firebasestorage.googleapis.com@evil.example/a.png'],
    ['帳號密碼資訊', 'https://user:pw@firebasestorage.googleapis.com/a.png'],
    ['evil@白名單主機', 'https://evil.example@firebasestorage.googleapis.com/a.png'],
    ['非預設連接埠', 'https://firebasestorage.googleapis.com:8443/a.png'],
    ['同源主機當前綴的惡意主機', 'https://toosterx.com.evil.example/a.png'],
    ['超過 2000 字元', `https://firebasestorage.googleapis.com/${'a'.repeat(2000)}`],
    ['空字串', ''],
    ['只有空白', '   '],
  ])('拒絕：%s', async (_name, image) => {
    expect(await preloadFor(image)).toHaveLength(0);
  });

  it('沒有 image 欄位、image 不是字串：不預載', async () => {
    expect(await preloadFor(undefined)).toHaveLength(0);
    const r = run({ fetch: okFetch([bannerDoc('b1', { image: { integerValue: '5' } })]) });
    await r.early;
    expect(r.links).toHaveLength(0);
  });

  it('同源判斷用 location.origin：換成別的網站網址就不放行', async () => {
    expect(await preloadFor('https://toosterx.com/a.webp', 'https://next.toosterx.com')).toHaveLength(0);
    expect(await preloadFor('https://next.toosterx.com/a.webp', 'https://next.toosterx.com')).toHaveLength(1);
  });

  // 「第一張候選橫幅」必須和 HomePage 實際畫的 banners[0] 是同一張（否則預載錯圖、白花頻寬）。
  // first＝parseRunQueryResponse()（＝HomePage 的 banners[0]）的 image；href＝預期插入的 preload 網址（null＝不插）。
  const FIRST_CASES: Array<{ name: string; payload: unknown[]; first: string | null; href: string | null }> = [
    {
      name: '特殊文件類型（shotgame）排在最前面 → 跳過，取下一張',
      payload: [withImage('a1', 'https://firebasestorage.googleapis.com/shot.webp', { type: restStr('shotgame') }), withImage('a2', GOOD_IMAGE)],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: 'watchParty／homeInfo／homeLayout 類型都跳過',
      payload: [
        withImage('a1', 'https://firebasestorage.googleapis.com/1.webp', { type: restStr('watchParty') }),
        withImage('a2', 'https://firebasestorage.googleapis.com/2.webp', { type: restStr('homeInfo') }),
        withImage('a3', 'https://firebasestorage.googleapis.com/3.webp', { type: restStr('homeLayout') }),
        withImage('a4', GOOD_IMAGE),
      ],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: '類型只是前後多空白（不算特殊類型，與 isHomeCarouselBanner 一致）→ 它就是第一張',
      payload: [withImage('a1', GOOD_IMAGE, { type: restStr('shotgame ') }), withImage('a2', 'https://firebasestorage.googleapis.com/2.webp')],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: '未啟用（inactive）排在前面 → 跳過',
      payload: [
        restDoc('a1', { status: restStr('inactive'), image: restStr('https://firebasestorage.googleapis.com/off.webp') }),
        withImage('a2', GOOD_IMAGE),
      ],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: '沒有 status 欄位 → 不算 active，跳過',
      payload: [restDoc('a1', { image: restStr('https://firebasestorage.googleapis.com/x.webp') }), withImage('a2', GOOD_IMAGE)],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: 'status 前後有空白 → 仍算 active（mapBannerDoc 會修剪）',
      payload: [restDoc('a1', { status: restStr(' active '), image: restStr(GOOD_IMAGE) })],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: 'slot 是 home-info／home-layout → 跳過',
      payload: [
        withImage('a1', 'https://firebasestorage.googleapis.com/1.webp', { slot: restStr('home-info') }),
        withImage('a2', 'https://firebasestorage.googleapis.com/2.webp', { slot: restStr('home-layout') }),
        withImage('a3', GOOD_IMAGE),
      ],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: 'id 欄位是 home-info（含前後空白）或文件 ID 是 home-layout → 跳過',
      payload: [
        withImage('a1', 'https://firebasestorage.googleapis.com/1.webp', { id: restStr(' home-info ') }),
        withImage('home-layout', 'https://firebasestorage.googleapis.com/2.webp'),
        withImage('home-info', 'https://firebasestorage.googleapis.com/3.webp'),
        withImage('a4', GOOD_IMAGE),
      ],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: '第一張候選沒有圖 → 不預載（不拿第二張的圖，輪播畫的第一張就是沒圖那張）',
      payload: [bannerDoc('a1'), withImage('a2', GOOD_IMAGE)],
      first: '',
      href: null,
    },
    {
      name: '第一張候選的圖是 http → 不預載（輪播同樣只收 http／https，且 http 不放行）',
      payload: [withImage('a1', 'http://firebasestorage.googleapis.com/a.png'), withImage('a2', GOOD_IMAGE)],
      first: 'http://firebasestorage.googleapis.com/a.png',
      href: null,
    },
    {
      name: '第一張候選的圖是其他主機 → 不預載，不改取第二張',
      payload: [withImage('a1', 'https://evil.example/a.png'), withImage('a2', GOOD_IMAGE)],
      first: 'https://evil.example/a.png',
      href: null,
    },
    {
      name: '第一張候選的圖是 javascript:（映射後為空字串）→ 不預載',
      payload: [withImage('a1', 'javascript:alert(1)'), withImage('a2', GOOD_IMAGE)],
      first: '',
      href: null,
    },
    {
      name: '文件名稱不是 banners 的直接子文件 → 映射會丟掉，預載也要跳過',
      payload: [
        { document: { name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/events/e1`, fields: restActiveFields({ image: restStr('https://firebasestorage.googleapis.com/e.webp') }) } },
        withImage('a2', GOOD_IMAGE),
      ],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: '文件名稱缺少 → 映射會丟掉，預載也要跳過',
      payload: [{ document: { fields: restActiveFields({ image: restStr('https://firebasestorage.googleapis.com/e.webp') }) } }, withImage('a2', GOOD_IMAGE)],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    {
      name: '前面有空結果標記與沒有 document 的元素',
      payload: [restEmptyMarker(), { readTime: 'x', skippedResults: 1 }, withImage('a2', GOOD_IMAGE)],
      first: GOOD_IMAGE,
      href: GOOD_IMAGE,
    },
    { name: '只有空結果標記 → 沒有橫幅，不預載', payload: [restEmptyMarker()], first: null, href: null },
  ];

  it.each(FIRST_CASES)('第一張候選與 HomePage 的 banners[0] 一致：$name', async ({ payload, first, href }) => {
    const list = parseRunQueryResponse(payload);
    expect(list === null || list.length === 0 ? null : (list[0]?.image ?? '')).toBe(first);
    const r = run({ fetch: okFetch(payload) });
    await r.early;
    expect(r.links.map((l) => l.attrs.href ?? null)).toEqual(href === null ? [] : [href]);
    // 輪播用的網址就是 sanitizeHttpUrl 後的同一個字串：preload 的 href 必須與它一字不差。
    if (href !== null) expect(list?.[0]?.image).toBe(href);
  });

  // 排除條件由 banners.ts 的 EXCLUDED_TYPES／EXCLUDED_KEYS 決定；內嵌 script 手寫了同一份。這裡對「集合的每個成員」各產生案例：
  // 日後 banners.ts 新增成員、而 index.html 沒跟上時，這些案例會紅（只鎖「刪除條件」不夠，要鎖「新增條件」）。
  const SKIPPED = 'https://firebasestorage.googleapis.com/skipped.webp';
  const EXCLUDED_CASES: Array<[string, Record<string, unknown>[]]> = [
    ...[...EXCLUDED_TYPES].map((type): [string, Record<string, unknown>[]] => [
      `類型 ${type}`,
      [withImage('a1', SKIPPED, { type: restStr(type) }), withImage('a2', GOOD_IMAGE)],
    ]),
    ...[...EXCLUDED_KEYS].flatMap((key): Array<[string, Record<string, unknown>[]]> => [
      [`slot ${key}`, [withImage('a1', SKIPPED, { slot: restStr(key) }), withImage('a2', GOOD_IMAGE)]],
      [`id 欄位 ${key}`, [withImage('a1', SKIPPED, { id: restStr(key) }), withImage('a2', GOOD_IMAGE)]],
      [`文件 ID ${key}`, [withImage(key, SKIPPED), withImage('a2', GOOD_IMAGE)]],
    ]),
  ];
  it('排除集合不是空的（防止上面的逐成員案例變成空轉）', () => {
    expect(EXCLUDED_TYPES.size).toBeGreaterThan(0);
    expect(EXCLUDED_KEYS.size).toBeGreaterThan(0);
    expect(EXCLUDED_CASES.length).toBe(EXCLUDED_TYPES.size + EXCLUDED_KEYS.size * 3);
  });
  it.each(EXCLUDED_CASES)('banners.ts 排除的特殊文件（%s）：HomePage 與內嵌 script 都跳過它，取下一張', async (_name, payload) => {
    expect(parseRunQueryResponse(payload)?.[0]?.image).toBe(GOOD_IMAGE);
    const r = run({ fetch: okFetch(payload) });
    await r.early;
    expect(r.links.map((l) => l.attrs.href)).toEqual([GOOD_IMAGE]);
  });

  it('文件名稱的專案不影響判斷（只看路徑形狀），名稱 7 段以外一律不當 banners 文件', async () => {
    const wrongShape = { document: { name: `${restDocName('a1')}/sub/x`, fields: restActiveFields({ image: restStr(GOOD_IMAGE) }) } };
    const r = run({ fetch: okFetch([wrongShape]) });
    await r.early;
    expect(r.links).toHaveLength(0);
    expect(parseRunQueryResponse([wrongShape])).toEqual([]);
  });

  it('圖網址無法解析（URL 建構會丟錯）：預載檢查的例外不影響 resolve 的原始回應，也不預載、不外洩', async () => {
    for (const image of ['https://', 'https://%', 'https://[::1']) {
      const payload = [withImage('b1', image)];
      const r = run({ fetch: okFetch(payload) });
      expect(json(await r.early), image).toBe(json(payload));
      expect(r.links, image).toHaveLength(0);
    }
  });

  it('怪異的欄位形狀（fields 是陣列／字串、元素是 null、document 是字串）不丟錯、不預載、仍 resolve 原始陣列', async () => {
    const payload = [null, 5, 'x', { document: 'x' }, { document: { name: restDocName('a1'), fields: [] } }, { document: { name: restDocName('a2'), fields: 'x' } }];
    const r = run({ fetch: okFetch(payload) });
    expect(json(await r.early)).toBe(json(payload));
    expect(r.links).toHaveLength(0);
  });
});

// ── 5. script 不得越權 ────────────────────────────────────────────────────────────────────────

describe('內嵌 script：只做兩件事，不越權', () => {
  const code = rawScript;

  it('不解析成畫面資料、不寫儲存、不動 DOM（除了一個 preload link）、不載入其他東西', () => {
    for (const forbidden of [
      /\beval\b/,
      /new Function|\bFunction\(/,
      /\bimport\b/,
      /firebase\//i,
      /\.setItem|removeItem|localStorage\.clear/,
      /sessionStorage|indexedDB|document\.cookie/,
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      /XMLHttpRequest|sendBeacon|WebSocket|importScripts|postMessage/,
      /console\./,
      /\.src\s*=|\.href\s*=/,
      /toPublicBanners|writeBannersSnapshot|mapBannerDoc|filterAndSortBanners/,
    ]) {
      expect(code, String(forbidden)).not.toMatch(forbidden);
    }
    // 唯一建立的元素是 link，唯一插入點是 document.head。
    expect(code.match(/createElement\(/g)).toHaveLength(1);
    expect(code).toContain("createElement('link')");
    expect(code.match(/appendChild\(/g)).toHaveLength(1);
    expect(code).toContain('document.head.appendChild(k)');
    // 只有 rel／as／fetchpriority／href 四個屬性。
    expect(Array.from(code.matchAll(/setAttribute\('([a-z]+)'/g), (m) => m[1])).toEqual(['rel', 'as', 'fetchpriority', 'href']);
    // 只對 Firestore REST 一個端點發請求，且只有一個 fetch 呼叫；全域只寫 __fcbEarlyBanners 一個。
    expect(code.match(/\bfetch\(/g)).toHaveLength(1);
    expect(code.match(/window\.[A-Za-z_]+\s*=/g)).toEqual(['window.__fcbEarlyBanners =']);
    expect(Array.from(code.matchAll(/https?:\/\/[a-z0-9.-]+/gi), (m) => m[0].toLowerCase())).toEqual(['https://firestore.googleapis.com']);
    expect(code).toContain("u.host !== 'firebasestorage.googleapis.com'");
  });

  it('沒有任何 console 輸出（成功與各種失敗路徑都靜默；沙盒的 console 是會記錄呼叫的替身）', async () => {
    const runs = [
      run({ fetch: okFetch([withImage('b1', GOOD_IMAGE)]) }),
      run({ fetch: okFetch('x') }),
      run({ fetch: okFetch([withImage('b1', 'https://')]) }),
      run({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) }),
      run({ fetch: async () => jsonResponse([], { status: 500 }).response }),
      run({ fetch: async () => fakeResponse('[{"document":').response }),
      run({ fetch: null }),
    ];
    for (const r of runs) await r.early;
    expect(runs.flatMap((r) => r.consoleCalls)).toEqual([]);
  });

  it('console 替身有鑑別力：被呼叫時真的會記下來（防止上面的斷言變成永遠通過）', () => {
    const code = "console.error('x'); console.warn('y');";
    const calls: string[] = [];
    runInNewContext(code, { console: new Proxy({}, { get: (_t, name) => () => void calls.push(String(name)) }) });
    expect(calls).toEqual(['error', 'warn']);
  });

  it('體積：維持小段（簡報目標 < 1 KB gzip，實測約 1.6 KB；這裡的上限只防止日後無意中膨脹，實測值記在報告）', () => {
    expect(gzipSync(builtScript()).length).toBeLessThan(1800);
  });
});

// ── 6. 在 index.html 裡的位置 ─────────────────────────────────────────────────────────────────

describe('index.html 中的內嵌 script', () => {
  it('在 <head> 內、連線提示之後、<title> 之前（越早越好），且在入口 module script 之前', () => {
    const at = rawHtml.indexOf('<script id="fcb-early-banners">');
    expect(at).toBeGreaterThan(rawHtml.indexOf('<head>'));
    expect(at).toBeGreaterThan(rawHtml.indexOf('rel="dns-prefetch" href="https://fc-football-6c8dc.firebaseapp.com"'));
    expect(at).toBeLessThan(rawHtml.indexOf('<title>'));
    expect(at).toBeLessThan(rawHtml.indexOf('<script type="module"'));
    expect(at).toBeLessThan(rawHtml.indexOf('</head>'));
    expect(rawHtml.match(new RegExp(`<script id="${EARLY_BANNERS_SCRIPT_ID}">`, 'g'))).toHaveLength(1);
  });

  it('註解寫明日後加 CSP 必須放行的來源', () => {
    expect(rawHtml).toContain('connect-src https://firestore.googleapis.com');
    expect(rawHtml).toContain('img-src https://firebasestorage.googleapis.com');
  });
});

// ── 7. 建置外掛 ──────────────────────────────────────────────────────────────────────────────

describe('建置外掛 earlyBannersHtml', () => {
  /** 原始 index.html 去掉 script 正上方那則說明註解（獨立於外掛的正規式：用位置切）。 */
  function rawWithoutDocComment(): string {
    const start = rawHtml.indexOf('    <!-- T-042d：');
    const end = rawHtml.indexOf('-->\n', start) + '-->\n'.length;
    expect(start).toBeGreaterThan(-1);
    expect(rawHtml.slice(end)).toMatch(/^ *<script id="fcb-early-banners">/);
    return rawHtml.slice(0, start) + rawHtml.slice(end);
  }

  it('把兩個代號各換成一次真值、刪掉 script 上方的說明註解，其餘 HTML 一字不動', () => {
    const out = buildHtml();
    expect(out).not.toContain(EARLY_BANNERS_PROJECT_TOKEN);
    expect(out).not.toContain(EARLY_BANNERS_VERSION_TOKEN);
    expect(out).toContain(`var P = '${FIREBASE_CONFIG.projectId}', V = '${APP_VERSION}'`);
    expect(
      out.replace(`var P = '${FIREBASE_CONFIG.projectId}', V = '${APP_VERSION}'`, `var P = '${EARLY_BANNERS_PROJECT_TOKEN}', V = '${EARLY_BANNERS_VERSION_TOKEN}'`),
    ).toBe(rawWithoutDocComment());
  });

  it('建置後輸出不含那段中文說明註解（約 0.6 KB gzip 不送給每個訪客），script 內容與連線提示等其他內容不變', () => {
    const out = buildHtml();
    for (const gone of ['T-042d：', 'early-banners-html.ts', 'src/app/early-banners.test.ts', '日後若加 CSP']) {
      expect(out, gone).not.toContain(gone);
      expect(rawHtml, gone).toContain(gone); // 原始碼裡還在（說明不丟）
    }
    // script 本體逐字相同（只換代號）：沒有被壓縮、沒有被改寫。
    const scriptOf = (html: string): string => /<script id="fcb-early-banners">[\s\S]*?<\/script>/.exec(html)?.[0] ?? '';
    expect(scriptOf(out)).toBe(
      scriptOf(rawHtml).replace(EARLY_BANNERS_PROJECT_TOKEN, FIREBASE_CONFIG.projectId).replace(EARLY_BANNERS_VERSION_TOKEN, APP_VERSION),
    );
    // 其他註解與連線提示完全沒被誤刪。
    expect(out).toContain('首頁一開就會連的來源');
    expect(out).toContain('<link rel="preconnect" href="https://firestore.googleapis.com" crossorigin />');
    expect(out).toContain('<title>ToosterX</title>');
    expect(Buffer.byteLength(rawHtml) - Buffer.byteLength(out)).toBeGreaterThan(400);
    // gzip 實際省下的量（防止之後註解被改回送出）。
    expect(gzipSync(rawHtml).length - gzipSync(out).length).toBeGreaterThan(150);
  });

  it('只刪「正上方緊鄰 script」的那一則註解：別的註解、不相鄰的註解、沒有註解的情況都不動', () => {
    const opts = { projectId: FIREBASE_CONFIG.projectId, appVersion: APP_VERSION, emulator: false };
    const script = `<script id="${EARLY_BANNERS_SCRIPT_ID}">var P = '${EARLY_BANNERS_PROJECT_TOKEN}', V = '${EARLY_BANNERS_VERSION_TOKEN}';</script>`;
    const out = transformEarlyBannersHtml(`<head>\n  <!-- keep 1 -->\n  <link a />\n  <!-- keep 2 -->\n  <meta b />\n  <!-- doc -->\n  ${script}\n  <title>t</title>\n</head>`, opts);
    expect(out).toContain('<!-- keep 1 -->');
    expect(out).toContain('<!-- keep 2 -->');
    expect(out).not.toContain('<!-- doc -->');
    expect(out).toContain('<link a />');
    expect(out).toContain('<meta b />');
    expect(out).toContain('<title>t</title>');
    // 沒有說明註解：照常處理。
    expect(transformEarlyBannersHtml(`<head>\n  <!-- keep -->\n  <link a />\n  ${script}\n</head>`, opts)).toContain('<!-- keep -->');
    // 註解跟 script 之間隔了別的標籤：不算緊鄰，不刪。
    expect(transformEarlyBannersHtml(`<head>\n  <!-- not adjacent -->\n  <link a />\n  ${script}\n</head>`, opts)).toContain('<!-- not adjacent -->');
    // 連續兩則註解：只刪貼著 script 的那一則。
    const two = transformEarlyBannersHtml(`<head>\n  <!-- first -->\n  <!-- second -->\n  ${script}\n</head>`, opts);
    expect(two).toContain('<!-- first -->');
    expect(two).not.toContain('<!-- second -->');
  });

  it('emulator 建置：整段 script 移除（連 Firestore REST 網址都不留）', () => {
    const out = buildHtml(true);
    expect(out).not.toContain(`id="${EARLY_BANNERS_SCRIPT_ID}"`);
    expect(out).not.toContain('firestore.googleapis.com/v1');
    expect(out).not.toContain('__fcbEarlyBanners =');
    // 其他腳本與骨架完全不受影響。
    expect(out).toContain('data-boot-shell');
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it('plugin 的 emulator 判斷與 shouldUseEmulator() 同條件：只有「非 PROD 且 VITE_FIREBASE_EMULATOR=1」才移除', () => {
    const plugin = earlyBannersHtml({ projectId: FIREBASE_CONFIG.projectId, appVersion: APP_VERSION });
    const configResolved = plugin.configResolved as unknown as (config: unknown) => void;
    const transform = plugin.transformIndexHtml as unknown as (html: string) => string;
    const hasScript = (): boolean => transform(rawHtml).includes(`id="${EARLY_BANNERS_SCRIPT_ID}"`);
    configResolved({ isProduction: true, env: { VITE_FIREBASE_EMULATOR: '1' } }); // PROD 建置：旗標被忽略
    expect(hasScript()).toBe(true);
    configResolved({ isProduction: false, env: { VITE_FIREBASE_EMULATOR: '1' } }); // dev＋emulator
    expect(hasScript()).toBe(false);
    configResolved({ isProduction: false, env: {} }); // dev，沒有 emulator（本機網址由 script 的 hostname 判斷擋下）
    expect(hasScript()).toBe(true);
    configResolved({ isProduction: false, env: { VITE_FIREBASE_EMULATOR: '0' } });
    expect(hasScript()).toBe(true);
    // 來源字串對照：兩邊的條件寫法沒有被改掉。
    expect(read('scripts/early-banners-html.ts')).toContain("!config.isProduction && config.env.VITE_FIREBASE_EMULATOR === '1'");
    expect(read('src/data/firebase.ts')).toMatch(/if \(import\.meta\.env\.PROD\) return false;\s*return import\.meta\.env\.VITE_FIREBASE_EMULATOR === '1';/);
  });

  it('找不到 script、代號數量不對、值格式不合 → 丟錯讓建置失敗', () => {
    const opts = { projectId: FIREBASE_CONFIG.projectId, appVersion: APP_VERSION, emulator: false };
    expect(() => transformEarlyBannersHtml('<html></html>', opts)).toThrow(/找不到/);
    expect(() => transformEarlyBannersHtml('<html></html>', { ...opts, emulator: true })).toThrow(/找不到/);
    const noProject = rawHtml.replace(EARLY_BANNERS_PROJECT_TOKEN, 'literal-project');
    expect(() => transformEarlyBannersHtml(noProject, opts)).toThrow(/恰好有一個/);
    const twoVersions = rawHtml.replace('K = /', `K2 = '${EARLY_BANNERS_VERSION_TOKEN}', K = /`);
    expect(() => transformEarlyBannersHtml(twoVersions, opts)).toThrow(/恰好有一個/);
    for (const projectId of ['', 'A-B', "x'y", 'x"y', 'a b', '<b>', '-abc', 'a'.repeat(64)]) {
      expect(() => transformEarlyBannersHtml(rawHtml, { ...opts, projectId }), projectId).toThrow(/projectId/);
    }
    for (const appVersion of ['', '0.2026 1027', "0.1'", '0.1</script>', '0.'.repeat(30)]) {
      expect(() => transformEarlyBannersHtml(rawHtml, { ...opts, appVersion }), appVersion).toThrow(/appVersion/);
    }
  });

  it('vite.config.ts 用 FIREBASE_CONFIG.projectId 與 APP_VERSION 註冊外掛（script 內的值與資料層同一個來源）', () => {
    expect(viteConfig).toContain("import { FIREBASE_CONFIG } from './src/data/firebase-config.ts';");
    expect(viteConfig).toContain("import { APP_VERSION } from './src/version.ts';");
    expect(viteConfig).toMatch(/plugins:\s*\[[^\]]*earlyBannersHtml\(\{ projectId: FIREBASE_CONFIG\.projectId, appVersion: APP_VERSION \}\)/);
  });
});

// ── 8. SW／CSP ──────────────────────────────────────────────────────────────────────────────

describe('Service Worker 與 CSP', () => {
  it('SW 只攔「導覽請求」一條路由：Firestore REST 與橫幅圖不經 SW（不快取、不改寫）', () => {
    expect(viteConfig.match(/urlPattern:/g)).toHaveLength(1);
    expect(viteConfig).toMatch(/urlPattern:\s*\(\{ request \}\)\s*=>\s*request\.mode === 'navigate'/);
    expect(viteConfig).toMatch(/navigateFallback:\s*null/);
    // 預存只含打包產物，沒有 json／API 回應。
    expect(viteConfig).toContain("globPatterns: ['**/*.{js,css,html,webp,svg}']");
    const workbox = viteConfig.slice(viteConfig.indexOf('workbox: {'), viteConfig.indexOf('export default'));
    expect(workbox.length).toBeGreaterThan(200);
    expect(workbox).not.toMatch(/googleapis\.com/i);
  });

  // CSP 絆線：目前整個 repo 沒有任何 CSP。只要任何會送給瀏覽器的設定出現 Content-Security-Policy（`_headers`、<meta http-equiv>、public/ 下的檔案），
  // 就必須放行早期 REST 與預載圖要用的兩個來源，否則內嵌 script 會被瀏覽器擋掉而靜默失效。範圍：vite.config.ts（產生 `_headers`）、index.html、public/ 下的文字檔；
  // 不涵蓋 Cloudflare 後台手動設定的標頭（repo 外，看不到）。
  function cspProblems(name: string, text: string): string[] {
    if (!/Content-Security-Policy/i.test(text)) return [];
    const problems: string[] = [];
    if (!/connect-src[^;\n]*https:\/\/firestore\.googleapis\.com/.test(text)) problems.push(`${name}：CSP 沒有放行 connect-src https://firestore.googleapis.com`);
    if (!/img-src[^;\n]*https:\/\/firebasestorage\.googleapis\.com/.test(text)) problems.push(`${name}：CSP 沒有放行 img-src https://firebasestorage.googleapis.com`);
    return problems;
  }

  /** 去掉註解再掃：index.html 的說明註解本身就寫了 connect-src／img-src 的放行字樣，不去掉的話任何 CSP 都會被它「放行」。 */
  function withoutComments(name: string, text: string): string {
    if (/\.html?$/i.test(name)) return text.replace(/<!--[\s\S]*?-->/g, '');
    // 程式碼檔只去掉「從行首開始」的區塊註解與「前面是空白」的 // 註解：字串裡的 '**/*.js'、'/*'、'https://…' 不會被誤當註解而吃掉後面的程式碼。
    if (/\.[cm]?[jt]sx?$/i.test(name)) return text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    return text;
  }

  function publicTextFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...publicTextFiles(full));
      else if (/(^_headers$|\.(html?|json|txt|toml|webmanifest|xml)$)/i.test(entry.name) && statSync(full).size < 512 * 1024) out.push(full);
    }
    return out;
  }

  it('CSP 檢查本身有鑑別力：有 CSP 沒放行會報、放行了不報、沒有 CSP 不報', () => {
    expect(cspProblems('x', "Content-Security-Policy: default-src 'self'")).toHaveLength(2);
    expect(cspProblems('x', "Content-Security-Policy: connect-src 'self' https://firestore.googleapis.com; img-src 'self'")).toHaveLength(1);
    expect(cspProblems('x', "Content-Security-Policy: img-src 'self' https://firebasestorage.googleapis.com")).toHaveLength(1);
    expect(
      cspProblems('x', "Content-Security-Policy: default-src 'self'; connect-src 'self' https://firestore.googleapis.com; img-src 'self' data: https://firebasestorage.googleapis.com"),
    ).toEqual([]);
    expect(cspProblems('x', '<meta http-equiv="content-security-policy" content="default-src \'self\'">')).toHaveLength(2);
    expect(cspProblems('x', 'no policy here')).toEqual([]);
    // 註解裡寫了放行字樣不算數：去掉註解後 CSP 仍然沒放行 → 要報。
    const metaWithComment = `<!-- 必須放行 connect-src https://firestore.googleapis.com 與 img-src https://firebasestorage.googleapis.com -->\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`;
    expect(cspProblems('a.html', metaWithComment)).toEqual([]); // 沒去掉註解就被註解「放行」＝假陰性
    expect(cspProblems('a.html', withoutComments('a.html', metaWithComment))).toHaveLength(2);
    const configWithComment = `// connect-src https://firestore.googleapis.com img-src https://firebasestorage.googleapis.com\nconst h = "Content-Security-Policy: default-src 'self'";`;
    expect(cspProblems('a.ts', withoutComments('a.ts', configWithComment))).toHaveLength(2);
    // 字串裡的 https:// 不會被當成 // 註解而吃掉。
    expect(withoutComments('a.ts', "const u = 'https://firestore.googleapis.com'; // note")).toContain('https://firestore.googleapis.com');
  });

  it('repo 內所有會送給瀏覽器的設定：沒有 CSP，或有 CSP 就已放行 connect-src firestore 與 img-src firebasestorage', () => {
    const sources: Array<[string, string]> = [
      ['vite.config.ts', viteConfig],
      ['index.html', rawHtml],
      ...publicTextFiles(resolve(ROOT, 'public')).map((file): [string, string] => [file.slice(ROOT.length + 1), readFileSync(file, 'utf8')]),
    ];
    expect(sources.length).toBeGreaterThanOrEqual(3); // 至少掃到 vite.config.ts、index.html、public/ 下的檔案（目前是 runtime-config.json；防止掃描範圍悄悄變空）
    expect(sources.some(([name]) => name.replace(/\\/g, '/').startsWith('public/'))).toBe(true);
    expect(sources.flatMap(([name, text]) => cspProblems(name, withoutComments(name, text)))).toEqual([]);
  });
});
