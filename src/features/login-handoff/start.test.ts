import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TTL_MS, readPending, writePending } from './pending';
import { pairingNumber as pairingNumberOf, sha256Hex } from './pairing';
import { beginLoginHandoff } from './start';
import { renderWait } from './view';

const showWaitForPending = vi.hoisted(() => vi.fn(async () => true));
const armWaitForPending = vi.hoisted(() => vi.fn(async () => true));

vi.mock('./claim', () => ({
  showWaitForPending,
  armWaitForPending,
  waitHandlers: { onDone() {}, onRetry() {}, onRestart() {}, onClose() {} },
}));

vi.mock('./view', () => ({
  renderWait: vi.fn(),
  renderRelay: vi.fn(),
}));

const SECRET = 'ab'.repeat(32);

/** 模擬使用者在「記住這個數字」畫面按下 go（true）或取消（false）。 */
function autoAnswer(go: boolean): void {
  vi.mocked(renderWait).mockImplementation((view, handlers) => {
    if (view?.kind === 'ready') queueMicrotask(() => (go ? handlers.onGo?.() : handlers.onClose()));
  });
}

beforeEach(() => autoAnswer(true));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  showWaitForPending.mockClear();
  armWaitForPending.mockClear();
  vi.mocked(renderWait).mockClear();
  localStorage.clear();
});

describe('beginLoginHandoff', () => {
  it('新祕密寫入 pending、交給 armWaitForPending，回跳網址帶 fcbHandoff', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(1);
      return array;
    });
    const uri = await beginLoginHandoff('https://toosterx.com/events/e?tab=1');
    const secret = '01'.repeat(32);
    const handoffId = await sha256Hex(secret);
    expect(uri).toBe(`https://toosterx.com/events/e?tab=1&fcbHandoff=${handoffId}`);
    expect(readPending()?.secret).toBe(secret);
    expect(armWaitForPending).toHaveBeenCalledOnce();
    expect(showWaitForPending).not.toHaveBeenCalled();
    expect(vi.mocked(renderWait).mock.calls[0]?.[0]).toMatchObject({ kind: 'ready' });
    expect(vi.mocked(renderWait).mock.calls[0]?.[0]).toHaveProperty('number', await pairingNumberOf(handoffId));
  });

  it('按「前往 LINE 登入」之前不回傳（呼叫端不會先 liff.login）', async () => {
    vi.mocked(renderWait).mockImplementation(() => undefined);
    let settled = false;
    void beginLoginHandoff('https://toosterx.com/').then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(armWaitForPending).not.toHaveBeenCalled();
    const handlers = vi.mocked(renderWait).mock.calls[0]?.[1];
    handlers?.onGo?.();
    await vi.waitFor(() => expect(settled).toBe(true));
    expect(armWaitForPending).toHaveBeenCalledOnce();
  });

  it('取消：清掉 pending、卸載畫面、回 null', async () => {
    autoAnswer(false);
    await expect(beginLoginHandoff('https://toosterx.com/')).resolves.toBeNull();
    expect(readPending()).toBeNull();
    expect(vi.mocked(renderWait).mock.calls.at(-1)?.[0]).toBeNull();
    expect(armWaitForPending).not.toHaveBeenCalled();
  });

  it('未逾 5 分鐘的 pending 顯示等待框並回 null', async () => {
    writePending({ secret: SECRET, createdAt: Date.now() });
    await expect(beginLoginHandoff('https://toosterx.com/')).resolves.toBeNull();
    expect(showWaitForPending).toHaveBeenCalledOnce();
    expect(armWaitForPending).not.toHaveBeenCalled();
    expect(readPending()?.secret).toBe(SECRET);
    expect(renderWait).not.toHaveBeenCalled();
  });

  it('已逾 5 分鐘就另開一筆', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(1_000_000);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(2);
      return array;
    });
    writePending({ secret: SECRET, createdAt: 1_000_000 - HANDOFF_TTL_MS });
    const uri = await beginLoginHandoff('https://toosterx.com/');
    expect(uri).toContain('fcbHandoff=');
    expect(readPending()?.secret).toBe('02'.repeat(32));
    expect(armWaitForPending).toHaveBeenCalledOnce();
    expect(showWaitForPending).not.toHaveBeenCalled();
  });

  it('停在記數字畫面超過 5 分鐘才按前往：顯示逾時、清 pending、回 null', async () => {
    vi.mocked(renderWait).mockImplementation(() => undefined);
    const p = beginLoginHandoff('https://toosterx.com/');
    await vi.waitFor(() => expect(vi.mocked(renderWait).mock.calls[0]?.[0]).toMatchObject({ kind: 'ready' }));
    const handlers = vi.mocked(renderWait).mock.calls[0]?.[1];
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + HANDOFF_TTL_MS + 1000);
    handlers?.onGo?.();
    await expect(p).resolves.toBeNull();
    expect(readPending()).toBeNull();
    expect(vi.mocked(renderWait).mock.calls.at(-1)?.[0]).toEqual({ kind: 'timeout' });
    expect(armWaitForPending).not.toHaveBeenCalled();
  });
});
