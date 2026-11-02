// 排程執行器（A _processScheduledMessages）：只送到期的、搶占失敗跳過、投遞失敗退回、送出後不重送。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminMessage } from './admin-message-model';

const repo = vi.hoisted(() => ({
  loadScheduledAdminMessages: vi.fn(),
  claimScheduledMessage: vi.fn(),
  markScheduledMessageSent: vi.fn(),
  releaseScheduledMessageClaim: vi.fn(),
}));
const send = vi.hoisted(() => ({
  deliverAdminMessage: vi.fn(),
  queueLinePushByTarget: vi.fn(),
}));
vi.mock('./admin-messages-repo', () => repo);
vi.mock('./admin-message-send', () => send);

import { _resetScheduledRunnerForTest, processScheduledMessages, subscribeScheduledChanges } from './scheduled-runner';

const NOW = Date.parse('2026-11-08T01:00:00Z'); // 台北 09:00

function msg(id: string, scheduledAt: string): AdminMessage {
  return { _docId: id, id, title: 't', body: 'b', status: 'scheduled', scheduledAt, targetType: 'all' };
}

beforeEach(() => {
  _resetScheduledRunnerForTest();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  repo.loadScheduledAdminMessages.mockResolvedValue([msg('due', '2026-11-08T09:00'), msg('later', '2026-11-08T10:00')]);
  repo.claimScheduledMessage.mockResolvedValue(true);
  repo.markScheduledMessageSent.mockResolvedValue(undefined);
  repo.releaseScheduledMessageClaim.mockResolvedValue(undefined);
  send.deliverAdminMessage.mockResolvedValue({});
  send.queueLinePushByTarget.mockResolvedValue({ status: 'none' });
});

afterEach(() => {
  vi.clearAllMocks();
});

const run = () => processScheduledMessages({ processorId: 'U-admin', senderUid: 'U-admin', now: () => NOW });

describe('processScheduledMessages', () => {
  it('只送到期的：搶占 → 投遞 → LINE → 標記 sent，並通知畫面', async () => {
    const changes: unknown[] = [];
    subscribeScheduledChanges((c) => changes.push(c));
    expect(await run()).toBe(1);
    expect(repo.claimScheduledMessage).toHaveBeenCalledTimes(1);
    expect(repo.claimScheduledMessage.mock.calls[0]?.[0]).toBe('due');
    expect(send.deliverAdminMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'due' }), 'U-admin');
    expect(send.queueLinePushByTarget).toHaveBeenCalledTimes(1);
    expect(repo.markScheduledMessageSent).toHaveBeenCalledWith('due');
    expect(changes).toEqual([{ docId: 'due', status: 'sent' }]);
  });

  it('搶占交易內的到期判斷用文件最新資料', async () => {
    await run();
    const isDue = repo.claimScheduledMessage.mock.calls[0]?.[2] as (d: Record<string, unknown>) => boolean;
    expect(isDue({ status: 'scheduled', scheduledAt: '2026-11-08T09:00' })).toBe(true);
    expect(isDue({ status: 'scheduled', scheduledAt: '2026-11-08T11:00' })).toBe(false);
  });

  it('搶占失敗（別人已處理）就跳過', async () => {
    repo.claimScheduledMessage.mockResolvedValue(false);
    expect(await run()).toBe(0);
    expect(send.deliverAdminMessage).not.toHaveBeenCalled();
  });

  it('投遞失敗：退回 scheduled（下一輪再試），不標 sent', async () => {
    const changes: unknown[] = [];
    subscribeScheduledChanges((c) => changes.push(c));
    send.deliverAdminMessage.mockRejectedValue(new Error('internal'));
    expect(await run()).toBe(0);
    expect(repo.releaseScheduledMessageClaim).toHaveBeenCalledWith('due', expect.any(Error));
    expect(repo.markScheduledMessageSent).not.toHaveBeenCalled();
    expect(send.queueLinePushByTarget).not.toHaveBeenCalled();
    expect(changes).toEqual([{ docId: 'due', status: 'scheduled' }]);
  });

  it('站內信已送出後 LINE 或標記失敗：不退回（避免重送）', async () => {
    send.queueLinePushByTarget.mockRejectedValue(new Error('line down'));
    repo.markScheduledMessageSent.mockRejectedValue(new Error('write failed'));
    await run();
    expect(repo.releaseScheduledMessageClaim).not.toHaveBeenCalled();
  });

  it('同一時間只跑一輪', async () => {
    let release!: () => void;
    repo.loadScheduledAdminMessages.mockReturnValue(new Promise((resolve) => {
      release = () => resolve([]);
    }));
    const first = run();
    expect(await run()).toBe(0);
    release();
    await first;
    expect(repo.loadScheduledAdminMessages).toHaveBeenCalledTimes(1);
  });
});
