import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  auditActionLabel,
  auditMetaKeyLabel,
  auditMetaPairs,
  auditResultLabel,
  auditSourceLabel,
  auditTargetLabel,
  dayKeysDesc,
  taipeiDayKey,
  toAuditEntry,
} from './audit-log-model';

describe('auditActionLabel', () => {
  it('已知動作回中文標籤', () => {
    expect(auditActionLabel('login_success')).toBe('登入成功');
    expect(auditActionLabel('event_signup')).toBe('活動報名');
    expect(auditActionLabel('admin_user_edit')).toBe('管理員編輯用戶資料');
    expect(auditActionLabel('late_cancel_red_clear')).toBe('解除臨取狀態');
  });

  it('未知動作原樣回傳', () => {
    expect(auditActionLabel('custom_action')).toBe('custom_action');
  });

  it('空字串回「未知行為」', () => {
    expect(auditActionLabel('')).toBe('未知行為');
  });

  it('AUDIT_ACTIONS 至少 10 個項目', () => {
    expect(AUDIT_ACTIONS.length).toBeGreaterThanOrEqual(10);
  });
});

describe('auditMetaKeyLabel', () => {
  it('已知鍵回中文', () => {
    expect(auditMetaKeyLabel('reason')).toBe('原因');
    expect(auditMetaKeyLabel('role')).toBe('角色');
    expect(auditMetaKeyLabel('ip')).toBe('IP');
  });

  it('未知鍵回原字', () => {
    expect(auditMetaKeyLabel('custom_key')).toBe('custom_key');
  });
});

describe('auditResultLabel', () => {
  it('success 與 failure 回中文', () => {
    expect(auditResultLabel('success')).toBe('成功');
    expect(auditResultLabel('failure')).toBe('失敗');
  });

  it('其他值回原字', () => {
    expect(auditResultLabel('skipped')).toBe('skipped');
  });

  it('空字串回「未標示」', () => {
    expect(auditResultLabel('')).toBe('未標示');
  });
});

describe('auditSourceLabel', () => {
  it('已知來源回中文', () => {
    expect(auditSourceLabel('web')).toBe('網頁');
    expect(auditSourceLabel('liff')).toBe('LINE');
    expect(auditSourceLabel('system')).toBe('系統');
    expect(auditSourceLabel('cloud_function')).toBe('後端');
  });

  it('未知來源原樣回傳', () => {
    expect(auditSourceLabel('mobile')).toBe('mobile');
  });

  it('空字串回「未標示」', () => {
    expect(auditSourceLabel('')).toBe('未標示');
  });
});

describe('auditTargetLabel', () => {
  it('有 targetLabel 時優先使用', () => {
    expect(auditTargetLabel({ targetType: 'user', targetLabel: '小明', targetId: 'U1' })).toBe('用戶：小明');
  });

  it('無 targetLabel 但 targetId 存在時使用 targetId', () => {
    expect(auditTargetLabel({ targetType: 'event', targetLabel: '', targetId: 'E1' })).toBe('活動：E1');
  });

  it('有 type 但無主要內容時顯示「未命名」', () => {
    expect(auditTargetLabel({ targetType: 'team', targetLabel: '', targetId: '' })).toBe('俱樂部：未命名');
  });

  it('完全空時回空字串', () => {
    expect(auditTargetLabel({ targetType: '', targetLabel: '', targetId: '' })).toBe('');
  });

  it('未知類型顯示原類型字', () => {
    expect(auditTargetLabel({ targetType: 'unknown_type', targetLabel: 'X', targetId: '' })).toBe('unknown_type：X');
  });
});

describe('auditMetaPairs', () => {
  it('字串值直接輸出', () => {
    expect(auditMetaPairs({ reason: 'why' })).toEqual([['reason', 'why']]);
  });

  it('物件值轉 JSON 一行', () => {
    expect(auditMetaPairs({ fields: { a: 1, b: 'c' } })).toEqual([['fields', '{"a":1,"b":"c"}']]);
  });

  it('陣列值也轉 JSON', () => {
    expect(auditMetaPairs({ list: [1, 2] })).toEqual([['list', '[1,2]']]);
  });

  it('空值與空字串被過濾', () => {
    expect(auditMetaPairs({ a: null, b: undefined, c: '', d: 'x' })).toEqual([['d', 'x']]);
  });

  it('空字串鍵被過濾', () => {
    expect(auditMetaPairs({ '': 'x', ok: 'y' })).toEqual([['ok', 'y']]);
  });

  it('空物件回空陣列', () => {
    expect(auditMetaPairs({})).toEqual([]);
  });
});

describe('toAuditEntry', () => {
  it('Functions 寫 actorId 時取 actorId', () => {
    const e = toAuditEntry('doc1', { action: 'login_success', actorId: 'U1' });
    expect(e.actorUid).toBe('U1');
    expect(e._docId).toBe('doc1');
  });

  it('actorUid 優先於 actorId', () => {
    const e = toAuditEntry('doc1', { actorUid: 'UA', actorId: 'UB' });
    expect(e.actorUid).toBe('UA');
  });

  it('actorName 與 UID 相同時視為空', () => {
    const e = toAuditEntry('doc1', { actorUid: 'U1', actorName: 'U1' });
    expect(e.actorName).toBe('');
  });

  it('actorName 與 UID 不同時保留', () => {
    const e = toAuditEntry('doc1', { actorUid: 'U1', actorName: '小明' });
    expect(e.actorName).toBe('小明');
  });

  it('createdAt 有 toMillis 時直接取值', () => {
    const e = toAuditEntry('doc1', { createdAt: { toMillis: () => 1234567890 } });
    expect(e.createdAtMs).toBe(1234567890);
  });

  it('createdAt 只有 seconds 時換算為毫秒', () => {
    const e = toAuditEntry('doc1', { createdAt: { seconds: 100 } });
    expect(e.createdAtMs).toBe(100000);
  });

  it('meta 非物件時回空物件', () => {
    expect(toAuditEntry('doc1', { meta: 'abc' }).meta).toEqual({});
    expect(toAuditEntry('doc1', {}).meta).toEqual({});
  });

  it('meta 物件原樣保留', () => {
    const e = toAuditEntry('doc1', { meta: { reason: 'x', ip: '1.1.1.1' } });
    expect(e.meta).toEqual({ reason: 'x', ip: '1.1.1.1' });
  });
});

describe('taipeiDayKey', () => {
  it('UTC 15:59:59.999 仍為台北當日', () => {
    expect(taipeiDayKey(Date.parse('2026-11-19T15:59:59.999Z'))).toBe('20261119');
  });

  it('UTC 16:00 換日為台北次日', () => {
    expect(taipeiDayKey(Date.parse('2026-11-19T16:00:00Z'))).toBe('20261120');
  });

  it('固定的台北中午對應到 yyyymmdd', () => {
    expect(taipeiDayKey(Date.parse('2026-11-19T04:00:00Z'))).toBe('20261119');
  });
});

describe('dayKeysDesc', () => {
  const nowMs = Date.parse('2026-11-19T04:00:00Z');
  const weekStart = Date.parse('2026-11-15T16:00:00Z');
  const weekEnd = Date.parse('2026-11-22T16:00:00Z');

  it('本週到 11/19 為 11/19,18,17,16 且不含未來日', () => {
    expect(dayKeysDesc(weekStart, weekEnd, nowMs)).toEqual([
      '20261119',
      '20261118',
      '20261117',
      '20261116',
    ]);
  });

  it('整月區間第一個是今天、最後一個是 1 日', () => {
    const monthStart = Date.parse('2026-10-31T16:00:00Z');
    const monthEnd = Date.parse('2026-11-30T16:00:00Z');
    const keys = dayKeysDesc(monthStart, monthEnd, nowMs);
    expect(keys[0]).toBe('20261119');
    expect(keys[keys.length - 1]).toBe('20261101');
  });
});
