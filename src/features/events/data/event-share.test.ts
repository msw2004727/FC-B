import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canUseShareTargetPicker, loadShareLiff, shareEvent, type ShareLiff } from './event-share';

const sdk = vi.hoisted(() => ({
  isLoggedIn: vi.fn(() => false),
  isApiAvailable: vi.fn(() => false),
  shareTargetPicker: vi.fn(async () => ({ status: 'success' as const })),
}));

vi.mock('@line/liff', () => ({ default: sdk }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const event = { id: 'public-1', title: '活動', date: '今天', location: '球場' };

function options(loggedIn = false) {
  return { loggedIn, signal: new AbortController().signal, showToast: vi.fn() };
}

function picker(): ShareLiff {
  return {
    isLoggedIn: () => true,
    isApiAvailable: () => true,
    shareTargetPicker: vi.fn(async () => ({ status: 'success' as const })),
  };
}

it('LIFF 不存在、未登入或 API 不可用時不提供 picker', async () => {
  expect(await loadShareLiff()).toBe(sdk);
  expect(canUseShareTargetPicker(null)).toBe(false);
  expect(canUseShareTargetPicker(sdk)).toBe(false);
  expect(canUseShareTargetPicker(picker())).toBe(true);
});

it('登入者複製 OG 文字，LINE 好友使用 Mini App Flex', async () => {
  const copy = vi.fn(async () => true);
  const opt = options(true);
  await shareEvent(event, opt, {
    loadLiff: async () => null,
    showSheet: async () => 'copy',
    copy,
  });
  expect(copy).toHaveBeenCalledExactlyOnceWith(
    '＜活動＞\n日期：今天\n地點：球場\nhttps://toosterx.com/event-share/public-1?v=20260707',
  );
  expect(opt.showToast).toHaveBeenCalledWith('連結已複製');

  const liff = picker();
  await shareEvent(event, opt, {
    loadLiff: async () => liff,
    showSheet: async () => 'line',
  });
  expect(liff.shareTargetPicker).toHaveBeenCalledWith([expect.objectContaining({
    type: 'flex',
    altText: '＜活動＞\n日期：今天\n地點：球場\nhttps://miniapp.line.me/2009525300-AuPGQ0sh?event=public-1',
  })]);
  expect(opt.showToast).toHaveBeenCalledWith('活動已分享到 LINE');
});

it('LINE 社群走 R/share，取消不執行分享', async () => {
  const openLine = vi.fn();
  const opt = options(true);
  await shareEvent(event, opt, {
    loadLiff: async () => null,
    showSheet: async () => 'line-share',
    openLine,
  });
  expect(openLine).toHaveBeenCalledOnce();
  openLine.mockClear();
  await shareEvent(event, opt, {
    loadLiff: async () => null,
    showSheet: async () => 'cancel',
    openLine,
  });
  expect(openLine).not.toHaveBeenCalled();
});

it('訪客 native share 失敗才複製，AbortError 不複製', async () => {
  const copy = vi.fn(async () => true);
  const opt = options();
  await shareEvent(event, opt, {
    loadLiff: async () => null,
    nativeShare: async () => { throw new Error('failed'); },
    copy,
  });
  expect(copy).toHaveBeenCalledOnce();
  expect(opt.showToast).toHaveBeenCalledWith('分享內容已複製到剪貼簿');
  copy.mockClear();
  await shareEvent(event, opt, {
    loadLiff: async () => null,
    nativeShare: async () => { throw new DOMException('cancel', 'AbortError'); },
    copy,
  });
  expect(copy).not.toHaveBeenCalled();
});

it('並行分享去重，拒絕後可重試', async () => {
  let reject!: (error: Error) => void;
  const loadLiff = vi.fn(() => new Promise<ShareLiff | null>((_resolve, fail) => {
    reject = fail;
  }));
  const first = shareEvent(event, options(), { loadLiff });
  await shareEvent(event, options(), { loadLiff });
  expect(loadLiff).toHaveBeenCalledOnce();
  reject(new Error('failed'));
  await first;
  const copy = vi.fn(async () => false);
  const opt = options();
  await shareEvent(event, opt, {
    loadLiff: async () => null,
    nativeShare: undefined,
    copy,
  });
  expect(copy).toHaveBeenCalledOnce();
  expect(opt.showToast).toHaveBeenCalledWith('複製失敗，請手動複製');
});

it('卸載後完成的非同步結果不再開選單或 toast', async () => {
  let resolve!: (value: ShareLiff | null) => void;
  const controller = new AbortController();
  const showSheet = vi.fn(async () => 'copy' as const);
  const showToast = vi.fn();
  const pending = shareEvent(event, {
    loggedIn: true,
    signal: controller.signal,
    showToast,
  }, {
    loadLiff: () => new Promise((done) => { resolve = done; }),
    showSheet,
  });
  controller.abort();
  resolve(null);
  await pending;
  expect(showSheet).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
});
