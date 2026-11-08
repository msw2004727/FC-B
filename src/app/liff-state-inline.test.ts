import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// T-093：把 index.html 的 #fcb-liff-state 放進 node:vm 執行（假的 location／history／sessionStorage）。
// 不連網、不碰真的 DOM。做法照 early-banners.test.ts 取出 script 再 runInNewContext。

const ROOT = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const rawHtml = read('index.html');
const script = /<script id="fcb-liff-state">([\s\S]*?)<\/script>/.exec(rawHtml)?.[1] ?? '';
const PUBLIC_ID_LITERAL = '/^[A-Za-z0-9_-]{1,120}$/';

interface ReplaceCall {
  state: unknown;
  title: string;
  url: string;
}

interface RunOptions {
  hostname?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  state?: unknown;
  session?: Map<string, string>;
  /** sessionStorage 讀寫都丟錯。 */
  sessionThrows?: boolean;
  /** replaceState 丟錯。 */
  replaceThrows?: boolean;
  /** 讀 location 就丟錯。 */
  locationThrows?: boolean;
  /** navigator.userAgent；省略時視為一般瀏覽器。 */
  userAgent?: string;
}

interface RunResult {
  replaceCalls: ReplaceCall[];
  /** replaceState 成功才更新；否則維持進來的網址。 */
  current: string;
  storage: Map<string, string>;
  consoleCalls: string[];
  /** script 看到的 window（檢查自動登入旗標）。 */
  win: Record<string, unknown>;
}

function run(options: RunOptions = {}): RunResult {
  const pathname = options.pathname ?? '/';
  const search = options.search ?? '';
  const hash = options.hash ?? '';
  const entered = `${pathname}${search}${hash}`;
  const replaceCalls: ReplaceCall[] = [];
  const storage = options.session ?? new Map<string, string>();
  const consoleCalls: string[] = [];
  const historyState = options.state === undefined ? { marker: 1 } : options.state;
  let current = entered;
  const location = options.locationThrows
    ? new Proxy({}, { get: () => { throw new Error('location unavailable'); } })
    : {
        hostname: options.hostname ?? 'toosterx.com',
        pathname,
        search,
        hash,
      };
  const history = {
    state: historyState,
    replaceState: (state: unknown, title: string, url: string): void => {
      if (options.replaceThrows) throw new Error('replace failed');
      replaceCalls.push({ state, title, url });
      current = url;
    },
  };
  const sessionStorage = options.sessionThrows
    ? {
        getItem: (): string => { throw new Error('storage blocked'); },
        setItem: (): void => { throw new Error('storage blocked'); },
      }
    : {
        getItem: (key: string): string | null => storage.get(key) ?? null,
        setItem: (key: string, value: string): void => { storage.set(key, value); },
      };
  const win: Record<string, unknown> = {};
  runInNewContext(script, {
    location,
    history,
    sessionStorage,
    navigator: { userAgent: options.userAgent ?? 'Mozilla/5.0 (iPhone) Safari/604.1' },
    window: win,
    URLSearchParams,
    console: new Proxy({}, { get: (_target, name) => () => void consoleCalls.push(String(name)) }),
  });
  return { replaceCalls, current, storage, consoleCalls, win };
}

function splitUrl(url: string): { pathname: string; search: string; hash: string } {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  return {
    pathname: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt),
    search: queryAt === -1 ? '' : beforeHash.slice(queryAt),
    hash,
  };
}

function stored(result: RunResult): unknown {
  return JSON.parse(result.storage.get('fcb:diag-loads') ?? 'null');
}

describe('fcb-liff-state 在 index.html 的位置', () => {
  it('是 <head> 裡第一個 script，比 fcb-early-banners 更前面，且在連線提示之後', () => {
    expect(script).not.toBe('');
    const head = rawHtml.slice(0, rawHtml.indexOf('</head>'));
    const first = head.indexOf('<script');
    expect(head.slice(first, first + '<script id="fcb-liff-state">'.length)).toBe('<script id="fcb-liff-state">');
    expect(first).toBeGreaterThan(head.indexOf('rel="dns-prefetch" href="https://fc-football-6c8dc.firebaseapp.com"'));
    expect(first).toBeLessThan(rawHtml.indexOf('<script id="fcb-early-banners">'));
    expect(rawHtml.match(/<script id="fcb-liff-state">/g)).toHaveLength(1);
  });

  it('與 share-link.ts 的 PUBLIC_ID regex 字面相同，且各只出現一次', () => {
    const share = read('src/app/share-link.ts');
    expect(share.split(PUBLIC_ID_LITERAL).length - 1).toBe(1);
    expect(script.split(PUBLIC_ID_LITERAL).length - 1).toBe(1);
  });

  it('只解碼一次：原始碼沒有 decodeURIComponent，也不寫 console 或 location.href', () => {
    expect(script).not.toContain('decodeURIComponent');
    expect(script).not.toContain('console');
    expect(script).not.toContain('.href');
    expect(script).not.toMatch(/window\.(?!__fcbLiffStateConsumed\b)/);
    expect(script).toContain('catch (e) {}');
    expect(script).toContain('catch (e2) {}');
    expect(script).toContain("history.replaceState(history.state, '', target)");
  });
});

describe('fcb-liff-state 改寫', () => {
  const sentinel = { marker: 'keep' };

  it.each([
    {
      shape: 'event',
      search: '?liff.state=%3Fevent%3DX&code=a%2Fb&bare&liff.referrer=https%3A%2F%2Fline.me&x=1+2',
      hash: '#access_token=SECRET_H&id_token=aa%3D%3D',
      url: '/events/X?code=a%2Fb&bare&liff.referrer=https%3A%2F%2Fline.me&x=1+2#access_token=SECRET_H&id_token=aa%3D%3D',
    },
    {
      shape: 'team',
      search: '?utm=1&liff.state=%3Fteam%3Dab_CD-12&liff.hback=2',
      hash: '#h=1',
      url: '/teams/ab_CD-12?utm=1&liff.hback=2#h=1',
    },
    {
      shape: 'profile',
      search: '?code=abc&liff.state=%3Fprofile%3Duid_1',
      hash: '#t=1',
      url: '/profile/uid_1?code=abc#t=1',
    },
  ])('$shape 落在正確路徑，其餘參數與 hash 原樣，只改寫一次', ({ search, hash, url }) => {
    const first = run({ search, hash, state: sentinel });
    expect(first.replaceCalls).toEqual([{ state: sentinel, title: '', url }]);
    expect(first.current).toBe(url);
    expect(first.consoleCalls).toEqual([]);
    const again = run({ ...splitUrl(url), state: sentinel });
    expect(again.replaceCalls).toEqual([]);
    expect(again.current).toBe(url);
  });

  it('ID 長度 120 接受', () => {
    const id = 'A'.repeat(120);
    const result = run({ search: `?liff.state=${encodeURIComponent(`?team=${id}`)}` });
    expect(result.replaceCalls.map((call) => call.url)).toEqual([`/teams/${id}`]);
  });

  it('外層 liff.state=%3Fevent%3DX 改成 /events/X，且網址不再有 liff.state', () => {
    const result = run({ search: '?liff.state=%3Fevent%3DX', hash: '#access_token=keep' });
    expect(result.current).toBe('/events/X#access_token=keep');
    expect(result.current).not.toContain('liff.state');
    expect(splitUrl(result.current).pathname).toBe('/events/X');
  });

  it('profile=qr 不改寫；event=qr 與 profile=qrX 照路徑改寫', () => {
    expect(run({ search: '?liff.state=%3Fprofile%3Dqr', hash: '#a=1' }).replaceCalls).toEqual([]);
    expect(run({ search: '?liff.state=%3Fevent%3Dqr' }).current).toBe('/events/qr');
    expect(run({ search: '?liff.state=%3Fprofile%3DqrX' }).current).toBe('/profile/qrX');
  });

  it.each([
    ['兩個 liff.state', '?liff.state=%3Fevent%3DX&liff.state=%3Fteam%3DY'],
    ['外層已有 event', '?event=Y&liff.state=%3Fevent%3DX'],
    ['外層 event 為空仍算有', '?event=&liff.state=%3Fevent%3DX'],
    ['外層已有 team', '?liff.state=%3Fteam%3Dab&team=other'],
    ['外層已有 profile', '?profile=p&liff.state=%3Fevent%3DX'],
    ['雙重編碼', '?liff.state=%253Fevent%253DX'],
    ['壞編碼 %', '?liff.state=%'],
    ['壞編碼截斷', '?liff.state=%3Fevent%3D%'],
    ['壞編碼 %ZZ', '?liff.state=%ZZ'],
    ['ID 含斜線', '?liff.state=%3Fevent%3Da%2Fb'],
    ['ID 含點', `?liff.state=${encodeURIComponent('?event=ab.c')}`],
    ['ID 含空白', `?liff.state=${encodeURIComponent('?event=ab c')}`],
    ['ID 非 ASCII', `?liff.state=${encodeURIComponent('?event=你好')}`],
    ['ID 長度 121', `?liff.state=${encodeURIComponent(`?event=${'a'.repeat(121)}`)}`],
    ['非白名單 ?foo=1', '?liff.state=%3Ffoo%3D1'],
    ['非白名單 /admin', '?liff.state=%2Fadmin'],
    ['參數名被編成 liff%2Estate', '?liff%2Estate=%3Fevent%3DX'],
    ['缺少問號', '?liff.state=event%3DX'],
    ['沒有 liff.state', '?event=X'],
  ])('拒絕：%s', (_label, search) => {
    const hash = '#access_token=keep';
    const result = run({ search, hash });
    expect(result.replaceCalls).toEqual([]);
    expect(result.current).toBe(`/${search}${hash}`);
    expect(result.consoleCalls).toEqual([]);
  });

  it.each(['/events/already', '/admin', '/index.html'])('pathname %s 不是 / 時不改寫', (pathname) => {
    const search = '?liff.state=%3Fevent%3DX';
    const result = run({ pathname, search, hash: '#a=1' });
    expect(result.replaceCalls).toEqual([]);
    expect(result.current).toBe(`${pathname}${search}#a=1`);
  });

  it('replaceState 拋錯時網址不動、不往外拋、不寫 console', () => {
    const search = '?liff.state=%3Fevent%3DX&code=1';
    const hash = '#access_token=1';
    const result = run({ search, hash, replaceThrows: true });
    expect(result.replaceCalls).toEqual([]);
    expect(result.current).toBe(`/${search}${hash}`);
    expect(result.consoleCalls).toEqual([]);
  });

  it('讀 location 拋錯時不往外拋、不寫 console', () => {
    const result = run({ locationThrows: true, search: '?liff.state=%3Fevent%3DX' });
    expect(result.replaceCalls).toEqual([]);
    expect(result.consoleCalls).toEqual([]);
    expect(result.storage.size).toBe(0);
  });
});

describe('fcb-liff-state 內測角標紀錄', () => {
  it('next.toosterx.com 只記參數名稱，任何值都不進 sessionStorage', () => {
    const result = run({
      hostname: 'next.toosterx.com',
      search: '?liff.state=%3Fevent%3DSECRET_X&code=SECRET_Y',
      hash: '#access_token=SECRET_H&id_token=SECRET_I&SECRET_BARE',
    });
    expect(result.current).toBe('/events/SECRET_X?code=SECRET_Y#access_token=SECRET_H&id_token=SECRET_I&SECRET_BARE');
    const raw = result.storage.get('fcb:diag-loads') ?? '';
    for (const secret of ['SECRET_X', 'SECRET_Y', 'SECRET_H', 'SECRET_I', 'SECRET_BARE']) {
      expect(raw).not.toContain(secret);
    }
    expect(stored(result)).toEqual([
      { n: 1, path: '/', q: ['liff.state', 'code'], h: ['access_token', 'id_token'], rewrote: true },
    ]);
    expect(result.consoleCalls).toEqual([]);
  });

  it.each(['toosterx.com', 'www.toosterx.com', 'localhost', 'next.toosterx.com.evil.test'])(
    '%s 不寫 sessionStorage，改寫仍照做',
    (hostname) => {
      const result = run({
        hostname,
        search: '?liff.state=%3Fevent%3DSECRET_X',
        hash: '#access_token=SECRET_H',
      });
      expect(result.storage.size).toBe(0);
      expect(result.current).toBe('/events/SECRET_X#access_token=SECRET_H');
    },
  );

  it('不改寫時 rewrote 為 false，值仍不進 sessionStorage', () => {
    const result = run({
      hostname: 'next.toosterx.com',
      search: '?liff.state=%3Ffoo%3DSECRET_X&code=SECRET_Y',
      hash: '#access_token=SECRET_H',
    });
    expect(result.replaceCalls).toEqual([]);
    const raw = result.storage.get('fcb:diag-loads') ?? '';
    expect(raw).not.toContain('SECRET_X');
    expect(raw).not.toContain('SECRET_Y');
    expect(raw).not.toContain('SECRET_H');
    expect(stored(result)).toEqual([
      { n: 1, path: '/', q: ['liff.state', 'code'], h: ['access_token'], rewrote: false },
    ]);
  });

  it('連續載入序號遞增，最多留 10 筆', () => {
    const session = new Map<string, string>();
    run({ hostname: 'next.toosterx.com', session, pathname: '/' });
    run({ hostname: 'next.toosterx.com', session, pathname: '/events/x' });
    expect(JSON.parse(session.get('fcb:diag-loads') ?? 'null')).toEqual([
      { n: 1, path: '/', q: [], h: [], rewrote: false },
      { n: 2, path: '/events/x', q: [], h: [], rewrote: false },
    ]);
    const seed = Array.from({ length: 10 }, (_item, index) => ({
      n: index + 1,
      path: '/old',
      q: ['a'],
      h: [] as string[],
      rewrote: false,
    }));
    session.set('fcb:diag-loads', JSON.stringify(seed));
    const result = run({ hostname: 'next.toosterx.com', session, pathname: '/events/x' });
    const saved = stored(result) as Array<{ n: number; path: string; q: string[]; h: string[]; rewrote: boolean }>;
    expect(saved).toHaveLength(10);
    expect(saved.map((item) => item.n)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const last = saved[saved.length - 1];
    if (!last) throw new Error('缺少最後一筆診斷');
    expect(last).toEqual({ n: 11, path: '/events/x', q: [], h: [], rewrote: false });
  });

  it('sessionStorage 壞掉或丟錯時仍改寫，且不往外拋', () => {
    const broken = new Map<string, string>([['fcb:diag-loads', 'not-json']]);
    const parsed = run({
      hostname: 'next.toosterx.com',
      session: broken,
      search: '?liff.state=%3Fevent%3DX',
      hash: '#a=1',
    });
    expect(parsed.current).toBe('/events/X#a=1');
    expect(stored(parsed)).toEqual([
      { n: 1, path: '/', q: ['liff.state'], h: ['a'], rewrote: true },
    ]);
    const thrown = run({
      hostname: 'next.toosterx.com',
      sessionThrows: true,
      search: '?liff.state=%3Fteam%3Dab',
      hash: '#id_token=1',
    });
    expect(thrown.current).toBe('/teams/ab#id_token=1');
    expect(thrown.consoleCalls).toEqual([]);
  });
});

describe('fcb-liff-state 自動登入旗標（站長 11-08 定案 Mini App 分享開頁要自動登入）', () => {
  const MINI_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) Line/26.16.1 LIFF';
  const LINE_BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) Line/26.16.1';

  it('Mini App 內消掉 liff.state 時設旗標', () => {
    const result = run({ search: '?liff.state=%3Fevent%3DX', userAgent: MINI_APP_UA });
    expect(result.current).toBe('/events/X');
    expect(result.win.__fcbLiffStateConsumed).toBe(true);
  });

  it.each([
    ['外部瀏覽器', 'Mozilla/5.0 (iPhone) Safari/604.1'],
    ['LINE 內建瀏覽器（沒有 LIFF）', LINE_BROWSER_UA],
  ])('%s 改寫照做但不設旗標', (_label, userAgent) => {
    const result = run({ search: '?liff.state=%3Fevent%3DX', userAgent });
    expect(result.current).toBe('/events/X');
    expect(result.win.__fcbLiffStateConsumed).toBeUndefined();
  });

  it('沒有改寫時（不符形狀）Mini App 也不設旗標', () => {
    const result = run({ search: '?liff.state=%3Ffoo%3D1', userAgent: MINI_APP_UA });
    expect(result.replaceCalls).toHaveLength(0);
    expect(result.win.__fcbLiffStateConsumed).toBeUndefined();
  });

  it('replaceState 拋錯時不設旗標', () => {
    const result = run({ search: '?liff.state=%3Fevent%3DX', userAgent: MINI_APP_UA, replaceThrows: true });
    expect(result.win.__fcbLiffStateConsumed).toBeUndefined();
  });

  it('UA 判斷與 login-redirect.ts#isLikelyMiniAppUserAgent 相同', () => {
    const source = read('src/data/login-redirect.ts');
    expect(source).toContain(String.raw`/\bLine\//i.test(userAgent) && /\bLIFF\b/.test(userAgent)`);
    expect(script).toContain(String.raw`/\bLine\//i.test(ua) && /\bLIFF\b/.test(ua)`);
  });
});
