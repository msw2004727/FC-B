import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TTL_MS, readPending, writePending } from './pending';
import { sha256Hex } from './pairing';
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
    expect(renderWait).not.toHaveBeenCalled();
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
});
