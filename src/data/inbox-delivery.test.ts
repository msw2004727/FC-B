import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));

import { callFn } from '@/data/callables';
import { InternalTestBlockedError, sha256Hex } from './internal-test';
import { buildInboxDeliveryDedupeKey, buildInboxMessage, deliverInboxMessage } from './inbox-delivery';

// golden 照 A js/modules/message/message-notify.js `_deliverMessageToInbox`／`_buildInboxDeliveryDedupeKey`
const NOW = new Date(2026, 9, 19, 8, 5, 0);
const base = {
  title: '俱樂部加入申請',
  body: '王小明 申請加入「測試隊」俱樂部，請審核此申請。',
  category: 'system',
  categoryName: '系統',
  targetUid: 'U-staff',
  senderName: '王小明',
  senderUid: 'U-applicant',
  now: NOW,
  random: () => 0.123456789,
};

beforeEach(() => {
  vi.mocked(callFn).mockReset();
  vi.mocked(callFn).mockResolvedValue(undefined as never);
});

describe('buildInboxMessage（A _deliverMessageToInbox）', () => {
  it('點對點訊息含 A 收件匣依賴的全部欄位', () => {
    const extra = { actionType: 'team_join_request', actionStatus: 'pending', meta: { teamId: 'tm_1' } };
    const msg = buildInboxMessage({ ...base, extra });
    expect(msg).toEqual({
      id: `msg_${NOW.getTime()}_${(0.123456789).toString(36).slice(2, 6)}`,
      type: 'system',
      typeName: '系統',
      title: base.title,
      preview: base.body,
      body: base.body,
      time: '2026/10/19 08:05',
      unread: true,
      readBy: [],
      hiddenBy: [],
      senderName: '王小明',
      fromUid: 'U-applicant',
      toUid: 'U-staff',
      targetUid: 'U-staff',
      targetTeamId: null,
      targetRoles: null,
      targetType: 'individual',
      dedupeKey: buildInboxDeliveryDedupeKey('system', base.title, base.body, 'U-staff', '王小明', extra),
      actionType: 'team_join_request',
      actionStatus: 'pending',
      meta: { teamId: 'tm_1' },
    });
  });

  it('preview 超過 40 字截斷並加 ...', () => {
    const body = '一'.repeat(41);
    expect(buildInboxMessage({ ...base, body }).preview).toBe(`${'一'.repeat(40)}...`);
    expect(buildInboxMessage({ ...base, body: '一'.repeat(40) }).preview).toBe('一'.repeat(40));
  });

  it('targetType 推導：無收件人時依 team／role／all', () => {
    expect(buildInboxMessage({ ...base, targetUid: null, extra: { targetTeamId: 'tm_1' } }).targetType).toBe('team');
    expect(buildInboxMessage({ ...base, targetUid: null, extra: { targetRoles: ['admin'] } }).targetType).toBe('role');
    expect(buildInboxMessage({ ...base, targetUid: null }).targetType).toBe('all');
  });
});

describe('buildInboxDeliveryDedupeKey', () => {
  it('明確 dedupeKey 優先；否則以 || 串接、角色排序', () => {
    expect(buildInboxDeliveryDedupeKey('c', 't', 'b', 'u', 's', { dedupeKey: '  k1 ' })).toBe('k1');
    expect(buildInboxDeliveryDedupeKey('c', 't', 'b', null, 's', { targetRoles: ['super_admin', 'admin'], targetType: 'role' }))
      .toBe('c||t||b||||||admin,super_admin||role||s');
  });
});

describe('deliverInboxMessage', () => {
  it('照 A _deliverToInboxCF 的 request 形狀呼叫 deliverToInbox', async () => {
    const msg = await deliverInboxMessage(base);
    expect(callFn).toHaveBeenCalledWith('deliverToInbox', {
      message: msg,
      targetUid: 'U-staff',
      targetTeamId: null,
      targetRoles: null,
      targetType: 'individual',
    });
  });

  it('Callable 失敗往外拋', async () => {
    vi.mocked(callFn).mockRejectedValueOnce(new Error('boom'));
    await expect(deliverInboxMessage(base)).rejects.toThrow('boom');
  });
});

describe('deliverInboxMessage 內測守衛', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('收件人不在名單或是廣播 → 擋下；在名單 → 送出', async () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', await sha256Hex('U-tester'));
    await expect(deliverInboxMessage(base)).rejects.toBeInstanceOf(InternalTestBlockedError);
    await expect(deliverInboxMessage({ ...base, targetUid: null })).rejects.toBeInstanceOf(InternalTestBlockedError);
    expect(callFn).not.toHaveBeenCalled();
    await deliverInboxMessage({ ...base, targetUid: 'U-tester' });
    expect(callFn).toHaveBeenCalledTimes(1);
  });
});

