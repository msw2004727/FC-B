import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENABLE_EVENT_BLOCKLIST_OPLOG, recordBlocklistOpLog } from './event-blocklist-oplog';
import type { BlocklistViewer } from './event-blocklist-model';
const write = vi.hoisted(() => vi.fn());
vi.mock('@/data/op-log', () => ({ writeOpLog: write }));
const viewer: BlocklistViewer = { uid: 'uidA', role: 'super_admin', displayName: '管理員', hasPermission: () => true };
beforeEach(() => { vi.clearAllMocks(); write.mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());
describe('黑名單管理', () => {
  it.each(['add', 'remove'] as const)('T12 操作紀錄 %s', async action => {
    await recordBlocklistOpLog(viewer, { id: 'evtA', title: '活動' }, action, '小明');
    const payload = write.mock.calls[0]?.[0];
    expect(Object.keys(payload).sort()).toEqual(['actorUid', 'content', 'eventId', 'operator', 'type', 'typeName']);
    expect(payload).toEqual({ actorUid: 'uidA', eventId: 'evtA', operator: '管理員',
      type: 'event_blocklist_' + action, typeName: action === 'add' ? '加入活動黑名單' : '移除活動黑名單',
      content: '活動「活動」' + (action === 'add' ? '加入' : '移除') + '黑名單：小明' });
    expect(payload.content).not.toMatch(/uidA|targetA|測試原因/);
    expect(ENABLE_EVENT_BLOCKLIST_OPLOG).toBe(true);
  });
  it('T12 停用紀錄', async () => {
    await recordBlocklistOpLog(viewer, {}, 'add', '小明', false);
    expect(write).not.toHaveBeenCalled();
  });
  it('T12 紀錄失敗', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    write.mockRejectedValue(new Error('targetA'));
    await expect(recordBlocklistOpLog(viewer, {}, 'add', '小明')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('targetA');
  });
  it('T12 共用紀錄回報失敗', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    write.mockImplementation(async (_input, onFailure: () => void) => onFailure());
    await expect(recordBlocklistOpLog(viewer, {}, 'add', '小明')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
