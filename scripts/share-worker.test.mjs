// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../public/_worker.js';

const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));

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
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/ce_1?v=20260707'), makeEnv());
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://asia-east1-fc-football-6c8dc.cloudfunctions.net/eventShareOg/ce_1?v=20260707');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
    expect(cacheStore.has('https://toosterx.com/event-share/ce_1?v=20260707')).toBe(true);
  });

  it('/team-share/{id} 轉給 teamShareOg', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await worker.fetch(new Request('https://toosterx.com/team-share/team_1'), makeEnv());
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://asia-east1-fc-football-6c8dc.cloudfunctions.net/teamShareOg/team_1');
  });

  it('上游失敗不快取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/x'), makeEnv());
    expect(res.status).toBe(500);
    expect(cacheStore.size).toBe(0);
  });

  it('快取命中不打上游', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    cacheStore.set('https://toosterx.com/event-share/x', new Response('cached'));
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/x'), makeEnv());
    expect(await res.text()).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 GET／HEAD 回 405', async () => {
    const res = await worker.fetch(new Request('https://toosterx.com/event-share/x', { method: 'POST' }), makeEnv());
    expect(res.status).toBe(405);
  });

  it('/og.png 回預設 OG 圖並快取一天', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://toosterx.com/og.png?x=1'), env);
    expect(await res.text()).toBe('asset:/assets/og/default.png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('其他路徑交回靜態資產', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://toosterx.com/event-sharex'), env);
    expect(await res.text()).toBe('asset:/event-sharex');
  });

  it('_routes.json 只攔分享與 /og.png', () => {
    expect(routes.include).toEqual(['/event-share', '/event-share/*', '/team-share', '/team-share/*', '/og.png']);
  });
});
