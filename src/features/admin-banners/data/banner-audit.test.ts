import { describe, expect, it, vi } from 'vitest';
import {
  BANNER_AUDIT_ACTION,
  BANNER_AUDIT_REASON,
  BANNER_OPLOG_TYPES,
  ENABLE_BANNER_AUDIT_LOG,
  ENABLE_BANNER_OPLOG,
  buildBannerOpLogEntry,
  recordBannerOpLog,
  recordBannerTransitionAudit,
} from './banner-audit';
import type { BannerTransition } from './banner-model';

const T: BannerTransition = {
  docId: 'ban1',
  id: 'ban1',
  label: '春季聯賽',
  from: 'scheduled',
  to: 'active',
  reason: 'publish_due',
  publishAt: '2026/10/27 10:00',
  unpublishAt: '',
};
const ACTOR = { uid: 'u_admin', displayName: '管理員' };
const ENTRY = { type: 'banner_toggle', typeName: 'Banner 上下架', content: '下架「春季聯賽」(ban1)' };

describe('recordBannerTransitionAudit（writeAuditLog，只用於惰性轉換；F3：旗標預設關閉）', () => {
  it('旗標預設關閉：借用 admin_user_edit 會污染稽核軌跡，在 Functions 有專用 action 前不送', async () => {
    expect(ENABLE_BANNER_AUDIT_LOG).toBe(false);
    const callFn = vi.fn().mockResolvedValue({ success: true });
    await recordBannerTransitionAudit(T, { callFn: callFn as never });
    expect(callFn).not.toHaveBeenCalled();
  });

  it('旗標明確關閉：不送', async () => {
    const callFn = vi.fn().mockResolvedValue({ success: true });
    await recordBannerTransitionAudit(T, { enabled: false, callFn: callFn as never });
    expect(callFn).not.toHaveBeenCalled();
  });

  it('旗標開啟：請求形狀固定（白名單內的 action、meta 只放允許的鍵）', async () => {
    const callFn = vi.fn().mockResolvedValue({ success: true });
    await recordBannerTransitionAudit(T, { enabled: true, callFn: callFn as never });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn).toHaveBeenCalledWith('writeAuditLog', {
      action: BANNER_AUDIT_ACTION,
      targetType: 'system',
      targetId: 'ban1',
      targetLabel: 'banner:ban1',
      result: 'success',
      source: 'web',
      meta: { reasonCode: BANNER_AUDIT_REASON, statusFrom: 'scheduled', statusTo: 'active' },
    });
    // functions/index.js ALLOWED_AUDIT_ACTIONS 目前沒有橫幅動作，暫借 admin_user_edit；專用 action 上線後改常數即可。
    expect(BANNER_AUDIT_ACTION).toBe('admin_user_edit');
  });

  it('失敗只 warn，不丟錯', async () => {
    const warn = vi.fn();
    const callFn = vi.fn().mockRejectedValue(new Error('invalid-argument'));
    await expect(
      recordBannerTransitionAudit(T, { enabled: true, callFn: callFn as never, warn }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[banners] writeAuditLog failed', expect.any(Error));
  });
});

describe('buildBannerOpLogEntry（A 沒有橫幅 _writeOpLog，B 新增的措辭）', () => {
  it('四種 type 與中文名稱', () => {
    expect(BANNER_OPLOG_TYPES).toEqual({
      edit: { type: 'banner_edit', typeName: '編輯 Banner' },
      toggle: { type: 'banner_toggle', typeName: 'Banner 上下架' },
      delete: { type: 'banner_delete', typeName: '刪除 Banner' },
      auto: { type: 'banner_auto', typeName: 'Banner 自動切換' },
    });
  });

  it('儲存：立即啟用與預約啟用', () => {
    expect(
      buildBannerOpLogEntry({ kind: 'edit', label: '春季聯賽', id: 'ban1', scheduled: false, publishAt: '2026/10/27 12:00' }),
    ).toEqual({ type: 'banner_edit', typeName: '編輯 Banner', content: '編輯「春季聯賽」(ban1)，立即啟用' });
    expect(
      buildBannerOpLogEntry({ kind: 'edit', label: '春季聯賽', id: 'ban1', scheduled: true, publishAt: '2026/11/05 10:00' }),
    ).toEqual({
      type: 'banner_edit',
      typeName: '編輯 Banner',
      content: '編輯「春季聯賽」(ban1)，預約 2026/11/05 10:00 啟用',
    });
  });

  it('下架／上架共用 banner_toggle（同 A 的 ann_toggle／ach_toggle）；刪除是 banner_delete', () => {
    expect(buildBannerOpLogEntry({ kind: 'delist', label: '春季聯賽', id: 'ban1' })).toEqual(ENTRY);
    expect(buildBannerOpLogEntry({ kind: 'relist', label: '春季聯賽', id: 'ban1' })).toEqual({
      type: 'banner_toggle',
      typeName: 'Banner 上下架',
      content: '上架「春季聯賽」(ban1)',
    });
    expect(buildBannerOpLogEntry({ kind: 'delete', label: '春季聯賽', id: 'ban1' })).toEqual({
      type: 'banner_delete',
      typeName: '刪除 Banner',
      content: '刪除「春季聯賽」(ban1)，已清空設定',
    });
  });

  it('惰性轉換：banner_auto，分「自動啟用」與「自動下架」', () => {
    expect(buildBannerOpLogEntry({ kind: 'auto', label: '春季聯賽', id: 'ban1', to: 'active' })).toEqual({
      type: 'banner_auto',
      typeName: 'Banner 自動切換',
      content: '「春季聯賽」(ban1)預約時間已到，自動啟用',
    });
    expect(buildBannerOpLogEntry({ kind: 'auto', label: '春季聯賽', id: 'ban1', to: 'expired' })).toEqual({
      type: 'banner_auto',
      typeName: 'Banner 自動切換',
      content: '「春季聯賽」(ban1)結束時間已到，自動下架',
    });
  });

  it('content 不含 UID 或網址', () => {
    const all = [
      buildBannerOpLogEntry({ kind: 'edit', label: 'x', id: 'ban1', scheduled: true, publishAt: '2026/11/05 10:00' }),
      buildBannerOpLogEntry({ kind: 'delist', label: 'x', id: 'ban1' }),
      buildBannerOpLogEntry({ kind: 'auto', label: 'x', id: 'ban1', to: 'expired' }),
    ];
    for (const entry of all) expect(entry.content).not.toMatch(/https?:|u_/);
  });
});

describe('recordBannerOpLog（operationLogs，旗標保留、預設開）', () => {
  it('旗標預設開', () => {
    expect(ENABLE_BANNER_OPLOG).toBe(true);
  });

  it('沒指定旗標時用預設（開）：寫入，actorUid ＝呼叫者 UID，operator ＝顯示名稱', async () => {
    const writeOpLog = vi.fn().mockResolvedValue(undefined);
    await recordBannerOpLog(ENTRY, ACTOR, { writeOpLog });
    expect(writeOpLog).toHaveBeenCalledTimes(1);
    expect(writeOpLog).toHaveBeenCalledWith({ ...ENTRY, actorUid: 'u_admin', operator: '管理員' });
    // 不寫 uid 欄位（只有 actorUid）。
    expect(Object.keys(writeOpLog.mock.calls[0]![0] as object)).not.toContain('uid');
  });

  it('旗標關閉：不呼叫 writeOpLog', async () => {
    const writeOpLog = vi.fn();
    await recordBannerOpLog(ENTRY, ACTOR, { opLogEnabled: false, writeOpLog });
    expect(writeOpLog).not.toHaveBeenCalled();
  });

  it('旗標開啟：呼叫 writeOpLog', async () => {
    const writeOpLog = vi.fn().mockResolvedValue(undefined);
    await recordBannerOpLog(ENTRY, ACTOR, { opLogEnabled: true, writeOpLog });
    expect(writeOpLog).toHaveBeenCalledTimes(1);
  });

  it('沒有顯示名稱時 operator 用「系統」', async () => {
    const writeOpLog = vi.fn().mockResolvedValue(undefined);
    await recordBannerOpLog(ENTRY, { uid: 'u1', displayName: '  ' }, { writeOpLog });
    await recordBannerOpLog(ENTRY, { uid: 'u1' }, { writeOpLog });
    expect(writeOpLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ operator: '系統', actorUid: 'u1' }));
    expect(writeOpLog).toHaveBeenNthCalledWith(2, expect.objectContaining({ operator: '系統', actorUid: 'u1' }));
  });

  it('writeOpLog 失敗只 warn，不丟錯', async () => {
    const warn = vi.fn();
    const writeOpLog = vi.fn().mockRejectedValue(new Error('permission-denied'));
    await expect(recordBannerOpLog(ENTRY, ACTOR, { writeOpLog, warn })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[banners] writeOpLog failed', expect.any(Error));
  });
});
