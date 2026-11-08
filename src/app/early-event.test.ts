import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { APP_VERSION } from '@/version';
import { fakeResponse, jsonResponse } from '@/features/home/data/__fixtures__/banners-rest';
import {
  EARLY_BANNERS_SCRIPT_ID,
  transformEarlyBannersHtml,
} from '../../scripts/early-banners-html';
import {
  EARLY_EVENT_PROJECT_TOKEN,
  EARLY_EVENT_SCRIPT_ID,
  earlyEventHtml,
  transformEarlyEventHtml,
} from '../../scripts/early-event-html';

// T-093 批 4：index.html 的 #fcb-early-event。把建置後的 script 放進 node:vm，不連網。
// 鎖定：只在 /events/<PUBLIC_ID> 且非本機時匿名 GET；失敗 resolve null；emulator 整段移除。

const ROOT = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const rawHtml = read('index.html');

function builtHtml(emulator = false): string {
  return transformEarlyEventHtml(rawHtml, {
    projectId: FIREBASE_CONFIG.projectId,
    emulator,
  });
}

function scriptOf(html: string): string {
  const block = new RegExp(`<script id="${EARLY_EVENT_SCRIPT_ID}">([\\s\\S]*?)</script>`).exec(html);
  if (!block?.[1]) throw new Error('找不到 fcb-early-event');
  return block[1];
}

const rawScript = scriptOf(rawHtml);
const builtScript = scriptOf(builtHtml(false));

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

interface Timer {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

interface RunOptions {
  hostname?: string;
  pathname?: string;
  search?: string;
  fetch?: FetchImpl | null;
}

interface RunResult {
  fetchCalls: Array<{ url: string; init: RequestInit }>;
  timers: Timer[];
  consoleCalls: string[];
  fired: boolean;
  early: Promise<unknown> | undefined;
}

const hanging: FetchImpl = () => new Promise<Response>(() => undefined);

function run(options: RunOptions = {}): RunResult {
  const timers: Timer[] = [];
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const consoleCalls: string[] = [];
  const fetchImpl = options.fetch === undefined ? hanging : options.fetch;
  const sandbox: Record<string, unknown> = {
    console: new Proxy({}, { get: (_target, name) => () => void consoleCalls.push(String(name)) }),
    location: {
      hostname: options.hostname ?? 'toosterx.com',
      pathname: options.pathname ?? '/',
      search: options.search ?? '',
    },
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
    AbortController,
  };
  if (fetchImpl) {
    sandbox.fetch = (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    };
  }
  sandbox.window = sandbox;
  runInNewContext(builtScript, sandbox);
  return {
    fetchCalls,
    timers,
    consoleCalls,
    fired: fetchCalls.length > 0,
    early: sandbox.__fcbEarlyEvent as Promise<unknown> | undefined,
  };
}

const MASK = [
  'mask.fieldPaths=title',
  'mask.fieldPaths=date',
  'mask.fieldPaths=location',
  'mask.fieldPaths=image',
  'mask.fieldPaths=imageVariants',
  'mask.fieldPaths=blockedUids',
].join('&');

function eventUrl(id: string): string {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/events/${id}?${MASK}`;
}

async function expectNoUnhandled(work: () => Promise<void>): Promise<void> {
  const reasons: unknown[] = [];
  const onReject = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', onReject);
  try {
    await work();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reasons).toEqual([]);
  } finally {
    process.off('unhandledRejection', onReject);
  }
}

describe('fcb-early-event 發不發', () => {
  it('非 /events/<id> 不發請求，也不掛 Promise', () => {
    for (const pathname of [
      '/', '', '/events', '/events/', '/events/x/', '/events/x/edit',
      '/activities', '/teams/x', '/EVENTS/x', '/events/has space', '/events/a.b',
    ]) {
      const result = run({ pathname });
      expect(result.fired, pathname).toBe(false);
      expect(result.early, pathname).toBeUndefined();
      expect(result.consoleCalls, pathname).toEqual([]);
    }
  });

  it('本機與區網主機不發', () => {
    for (const hostname of [
      'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0',
      'dev.localhost', 'printer.local',
      '10.1.2.3', '192.168.1.9', '172.16.0.1', '172.31.255.1',
    ]) {
      const result = run({ pathname: '/events/x', hostname });
      expect(result.fired, hostname).toBe(false);
      expect(result.early, hostname).toBeUndefined();
    }
  });

  it('/events/<id> 在正式主機發一次匿名 GET，網址含專案與六個 mask', () => {
    const result = run({ pathname: '/events/abc_DEF-123', search: '?utm=1' });
    expect(result.fetchCalls).toHaveLength(1);
    const call = result.fetchCalls[0];
    if (!call) throw new Error('沒有請求');
    expect(call.url).toBe(eventUrl('abc_DEF-123'));
    expect(call.init.method).toBe('GET');
    expect(call.init.credentials).toBe('omit');
    expect(call.init.headers).toBeUndefined();
    expect(call.url).not.toContain('key=');
    expect(call.url).not.toContain('apiKey');
    expect(JSON.stringify(call.init)).not.toMatch(/authorization/i);
    expect(result.timers.map((timer) => timer.ms)).toEqual([4000]);
    expect(result.early).toBeInstanceOf(Promise);
  });
});

describe('fcb-early-event 失敗一律 null', () => {
  it('成功時 Promise 是原始文件，不寫 console', async () => {
    const doc = {
      name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/events/x`,
      fields: { title: { stringValue: '提早' } },
    };
    await expectNoUnhandled(async () => {
      const result = run({
        pathname: '/events/x',
        fetch: async () => jsonResponse(doc).response,
      });
      await expect(result.early).resolves.toEqual(doc);
      expect(result.consoleCalls).toEqual([]);
    });
  });

  it('404、拒絕、壞 JSON、超過 256KB 都 resolve null，且沒有 unhandledrejection', async () => {
    await expectNoUnhandled(async () => {
      const missing = run({
        pathname: '/events/x',
        fetch: async () => fakeResponse('', { status: 404 }).response,
      });
      const rejected = run({
        pathname: '/events/x',
        fetch: async () => {
          throw new Error('offline');
        },
      });
      const broken = run({
        pathname: '/events/x',
        fetch: async () => fakeResponse('not-json').response,
      });
      const oversize = run({
        pathname: '/events/x',
        fetch: async () => fakeResponse('{}', { headers: { 'content-length': '262145' } }).response,
      });
      await expect(missing.early).resolves.toBeNull();
      await expect(rejected.early).resolves.toBeNull();
      await expect(broken.early).resolves.toBeNull();
      await expect(oversize.early).resolves.toBeNull();
      expect([
        ...missing.consoleCalls,
        ...rejected.consoleCalls,
        ...broken.consoleCalls,
        ...oversize.consoleCalls,
      ]).toEqual([]);
    });
  });
});

describe('fcb-early-event 原始碼邊界', () => {
  it('不解析畫面欄位、不寫 storage、不插元素、不 import、不碰 href', () => {
    for (const banned of [
      'stringValue', 'safeImageUrl', 'localStorage', 'sessionStorage', 'createElement',
      'import(', '.href', 'console', 'setItem', 'innerHTML', 'document.',
    ]) {
      expect(rawScript, banned).not.toContain(banned);
    }
    expect(rawScript.match(/window\.[A-Za-z0-9_]+\s*=/g)).toEqual(['window.__fcbEarlyEvent =']);
    expect(rawScript).not.toContain('/^[A-Za-z0-9_-]{1,120}$/');
    expect(rawScript).toContain('/^\\/events\\/([A-Za-z0-9_-]{1,120})$/');
    expect(rawScript.split(EARLY_EVENT_PROJECT_TOKEN).length - 1).toBe(1);
    const local = '/^(localhost|127\\.0\\.0\\.1|::1|\\[::1\\]|0\\.0\\.0\\.0)$|\\.(localhost|local)$|^(10\\.\\d{1,3}|192\\.168|172\\.(1[6-9]|2\\d|3[01]))\\.\\d{1,3}\\.\\d{1,3}$/';
    const banners = /<script id="fcb-early-banners">([\s\S]*?)<\/script>/.exec(rawHtml)?.[1] ?? '';
    expect(rawScript).toContain(local);
    expect(banners).toContain(local);
  });
});

describe('建置外掛 earlyEventHtml', () => {
  it('emulator 建置整段移除（含說明註解），橫幅與 liff script 留著', () => {
    const out = builtHtml(true);
    expect(out).not.toContain(`id="${EARLY_EVENT_SCRIPT_ID}"`);
    expect(out).not.toContain('__fcbEarlyEvent');
    expect(out).not.toContain('early-event-html.ts');
    expect(out).toContain('id="fcb-liff-state"');
    expect(out).toContain(`id="${EARLY_BANNERS_SCRIPT_ID}"`);
  });

  it('非 emulator 只替換自己 script 裡的那一個代號，橫幅 script 的代號留著', () => {
    const out = builtHtml(false);
    const block = new RegExp(`<script id="${EARLY_EVENT_SCRIPT_ID}">[\\s\\S]*?</script>`).exec(out)?.[0] ?? '';
    expect(block).toContain(FIREBASE_CONFIG.projectId);
    expect(block.split(FIREBASE_CONFIG.projectId).length - 1).toBe(1);
    expect(block).not.toContain(EARLY_EVENT_PROJECT_TOKEN);
    expect(out).not.toContain('early-event-html.ts');
    const banners = new RegExp(`<script id="${EARLY_BANNERS_SCRIPT_ID}">[\\s\\S]*?</script>`).exec(out)?.[0] ?? '';
    expect(banners).toContain(EARLY_EVENT_PROJECT_TOKEN);
  });

  it('找不到 script、代號數量不對、projectId 不合 → 丟錯（emulator 也要找得到 script）', () => {
    const opts = { projectId: FIREBASE_CONFIG.projectId, emulator: false };
    expect(() => transformEarlyEventHtml('<html></html>', opts)).toThrow(/找不到/);
    expect(() => transformEarlyEventHtml('<html></html>', { ...opts, emulator: true })).toThrow(/找不到/);
    const doubled = rawHtml.replace(
      `var P = '${EARLY_EVENT_PROJECT_TOKEN}', L = location`,
      `var P = '${EARLY_EVENT_PROJECT_TOKEN}', Q = '${EARLY_EVENT_PROJECT_TOKEN}', L = location`,
    );
    expect(() => transformEarlyEventHtml(doubled, opts)).toThrow(/恰好有一個/);
    for (const projectId of ['', 'A-B', "x'y", 'a b', '-abc', 'a'.repeat(64)]) {
      expect(() => transformEarlyEventHtml(rawHtml, { ...opts, projectId }), projectId).toThrow(/projectId/);
    }
  });

  it('plugin 的 emulator 條件與橫幅外掛相同', () => {
    const plugin = earlyEventHtml({ projectId: FIREBASE_CONFIG.projectId });
    const configResolved = plugin.configResolved as unknown as (config: unknown) => void;
    const transform = plugin.transformIndexHtml as unknown as (html: string) => string;
    const hasScript = (): boolean => transform(rawHtml).includes(`id="${EARLY_EVENT_SCRIPT_ID}"`);
    configResolved({ isProduction: true, env: { VITE_FIREBASE_EMULATOR: '1' } });
    expect(hasScript()).toBe(true);
    configResolved({ isProduction: false, env: { VITE_FIREBASE_EMULATOR: '1' } });
    expect(hasScript()).toBe(false);
    configResolved({ isProduction: false, env: {} });
    expect(hasScript()).toBe(true);
    expect(read('scripts/early-event-html.ts')).toContain(
      "!config.isProduction && config.env.VITE_FIREBASE_EMULATOR === '1'",
    );
    expect(read('vite.config.ts')).toContain(
      'earlyEventHtml({ projectId: FIREBASE_CONFIG.projectId })',
    );
  });

  it('兩段外掛串起來就是建置契約：正式兩段都在且代號換完，emulator 兩段與 /v1 都不留（不讀 dist）', () => {
    const chain = (emulator: boolean): string => {
      const banners = transformEarlyBannersHtml(rawHtml, {
        projectId: FIREBASE_CONFIG.projectId,
        appVersion: APP_VERSION,
        emulator,
      });
      return transformEarlyEventHtml(banners, { projectId: FIREBASE_CONFIG.projectId, emulator });
    };
    const prod = chain(false);
    expect(prod).toContain('id="fcb-early-banners"');
    expect(prod).toContain('id="fcb-early-event"');
    expect(prod).toContain(FIREBASE_CONFIG.projectId);
    expect(prod).not.toContain('__FCB_');
    expect(prod).toContain('id="fcb-liff-state"');
    const emu = chain(true);
    expect(emu).not.toContain('id="fcb-early-event"');
    expect(emu).not.toContain('id="fcb-early-banners"');
    expect(emu).not.toContain('__fcbEarlyEvent');
    expect(emu).not.toContain('__fcbEarlyBanners');
    expect(emu).not.toContain('firestore.googleapis.com/v1');
    expect(emu).toContain('id="fcb-liff-state"');
    expect(emu).toContain('data-boot-shell');
  });
});
