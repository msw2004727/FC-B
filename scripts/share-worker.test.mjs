// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../public/_worker.js';

const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));

const BOT_UA = 'facebookexternalhit/1.1';
const HUMAN_UA = 'Mozilla/5.0 (iPhone) Line/14.0';

function makeCtx() {
  const pending = [];
  return { pending, waitUntil: (p) => { pending.push(p); } };
}

function makeEnv() {
  return { ASSETS: { fetch: vi.fn(async (req) => new Response(`asset:${new URL(req.url).pathname}`, { status: 200 })) } };
}

let cacheStore;
beforeEach(() => {
  cacheStore = new Map();
  globalThis.caches = {
    default: {
      match: vi.fn(async (req) => cacheStore.get(req.url)),
      put: vi.fn(async (req, res) => { cacheStore.set(req.url, res); }),
    },
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.caches;
});

describe('_worker.js 分享預覽代理', () => {
  it('/event-share/{id} 轉給 eventShareOg，保留查詢字串並快取 300 秒', async () => {
    const fetchMock = vi.fn(async () => new Response('<meta property="og:title">', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = makeCtx();
    const res = await worker.fetch(
      new Request('https://toosterx.com/event-share/ce_1?v=20260707', { headers: { 'user-agent': HUMAN_UA } }),
      makeEnv(), ctx,
    );
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://asia-east1-fc-football-6c8dc.cloudfunctions.net/eventShareOg/ce_1?v=20260707');
    // UA 原樣轉給上游（Functions 依 UA 決定要不要跳轉）
    expect(fetchMock.mock.calls[0][1].headers.get('user-agent')).toBe(HUMAN_UA);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
    await Promise.all(ctx.pending);
    expect(cacheStore.has('https://toosterx.com/event-share/ce_1?v=20260707&__ogbot=0')).toBe(true);
  });

  it('/team-share/{id} 轉給 teamShareOg', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await worker.fetch(new Request('https://toosterx.com/team-share/team_1'), makeEnv(), makeCtx());
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://asia-east1-fc-football-6c8dc.cloudfunctions.net/teamShareOg/team_1');
  });

  it('上游失敗不快取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/x'), makeEnv(), makeCtx());
    expect(res.status).toBe(500);
    expect(cacheStore.size).toBe(0);
  });

  it('快取命中不打上游', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    cacheStore.set('https://toosterx.com/event-share/x?__ogbot=0', new Response('cached'));
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/x'), makeEnv(), makeCtx());
    expect(await res.text()).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('爬蟲與真人分開快取（上游回不同版本）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(
      init.headers.get('user-agent') === BOT_UA ? 'bot-version' : 'human-version', { status: 200 },
    )));
    const env = makeEnv();
    const botCtx = makeCtx();
    const bot = await worker.fetch(new Request('https://toosterx.com/event-share/ce_1', { headers: { 'user-agent': BOT_UA } }), env, botCtx);
    expect(await bot.text()).toBe('bot-version');
    await Promise.all(botCtx.pending);
    const human = await worker.fetch(new Request('https://toosterx.com/event-share/ce_1', { headers: { 'user-agent': HUMAN_UA } }), env, makeCtx());
    expect(await human.text()).toBe('human-version');
    expect([...cacheStore.keys()]).toEqual(['https://toosterx.com/event-share/ce_1?__ogbot=1']);
  });

  it('HEAD 原樣轉給上游且不進快取', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = makeCtx();
    await worker.fetch(new Request('https://toosterx.com/event-share/x', { method: 'HEAD' }), makeEnv(), ctx);
    expect(fetchMock.mock.calls[0][1].method).toBe('HEAD');
    expect(ctx.pending).toHaveLength(0);
    expect(cacheStore.size).toBe(0);
  });

  it('不帶 id 的 /event-share 也轉給上游', async () => {
    const fetchMock = vi.fn(async () => new Response('x', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await worker.fetch(new Request('https://toosterx.com/event-share'), makeEnv(), makeCtx());
    expect(fetchMock.mock.calls[0][0]).toBe('https://asia-east1-fc-football-6c8dc.cloudfunctions.net/eventShareOg');
  });

  it('非 GET／HEAD 回 405', async () => {
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/x', { method: 'POST' }), makeEnv(), makeCtx());
    expect(res.status).toBe(405);
  });

  it('/og.png 是實體檔（與預設 OG 圖相同）', () => {
    expect(readFileSync(new URL('../public/og.png', import.meta.url)))
      .toEqual(readFileSync(new URL('../public/assets/og/default.png', import.meta.url)));
  });

  it('其他路徑交回靜態資產', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://toosterx.com/event-sharex'), env, makeCtx());
    expect(await res.text()).toBe('asset:/event-sharex');
  });

  it('_routes.json 只攔分享路徑', () => {
    expect(routes.include).toEqual(['/event-share', '/event-share/*', '/team-share', '/team-share/*']);
  });
});
