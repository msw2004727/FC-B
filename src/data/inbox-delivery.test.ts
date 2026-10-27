import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));

import { callFn } from '@/data/callables';
import {
  _resetRecentInboxDeliveryForTest,
  buildInboxDeliveryDedupeKey,
  buildInboxMessage,
  deliverInboxMessage,
  isAlreadyExistsError,
} from './inbox-delivery';

// golden 照 A js/modules/message/message-notify.js `_deliverMessageToInbox`／`_buildInboxDeliveryDedupeKey`
const NOW = new Date('2026-10-19T08:05:00+08:00');
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
  _resetRecentInboxDeliveryForTest();
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

  it('台北 00:30 的 time 不會變成前一天', () => {
    expect(buildInboxMessage({
      ...base,
      now: new Date('2026-10-19T00:30:00+08:00'),
    }).time).toBe('2026/10/19 00:30');
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

describe('isAlreadyExistsError', () => {
  it.each([
    'functions/already-exists',
    'already-exists',
  ])('只依正確的 code 判定已存在：%s', (code) => {
    expect(isAlreadyExistsError({ code })).toBe(true);
  });

  it.each([
    undefined,
    null,
    false,
    0,
    'already-exists',
    {},
    { message: 'MESSAGE_ID_ALREADY_EXISTS' },
    { code: undefined },
    { code: null },
    { code: 123 },
    { code: {} },
    { code: 'Already-Exists' },
    { code: 'functions/Already-Exists' },
    { code: 'other/functions/already-exists' },
    { code: 'functions/functions/already-exists' },
    { code: 'functions/internal', message: 'MESSAGE_ID_ALREADY_EXISTS' },
  ])('非物件或不符合的 code 回傳 false：%j', (err) => {
    expect(isAlreadyExistsError(err)).toBe(false);
  });
});

describe('deliverInboxMessage', () => {
  it.each([
    'functions/already-exists',
    'already-exists',
  ])('Callable 回 %s 時回傳原訊息物件、不拋錯', async (code) => {
    vi.mocked(callFn).mockRejectedValueOnce({
      code,
      message: 'MESSAGE_ID_ALREADY_EXISTS',
    });

    const message = await deliverInboxMessage(base);

    expect(message).toEqual(buildInboxMessage(base));
    expect(callFn).toHaveBeenCalledTimes(1);
    const request = vi.mocked(callFn).mock.calls[0]![1] as {
      message: Record<string, unknown>;
    };
    expect(message).toBe(request.message);
  });

  it('已存在後保留 dedupe 鍵，5 秒內相同內容不再呼叫 Callable', async () => {
    vi.mocked(callFn).mockRejectedValueOnce({
      code: 'functions/already-exists',
      message: 'MESSAGE_ID_ALREADY_EXISTS',
    });

    await expect(deliverInboxMessage(base)).resolves.toEqual(buildInboxMessage(base));
    await expect(
      deliverInboxMessage({ ...base, now: new Date(NOW.getTime() + 4999) }),
    ).resolves.toBeNull();
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it('permission-denied 往外拋並釋放 dedupe 鍵，再次投遞會重新呼叫 Callable', async () => {
    const error = {
      code: 'functions/permission-denied',
      message: 'PERMISSION_DENIED',
    };
    vi.mocked(callFn).mockRejectedValueOnce(error);

    await expect(deliverInboxMessage(base)).rejects.toBe(error);
    expect(callFn).toHaveBeenCalledTimes(1);

    await expect(deliverInboxMessage(base)).resolves.toEqual(buildInboxMessage(base));
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it('message 含 ALREADY_EXISTS 但 code 為 internal 仍往外拋', async () => {
    const error = {
      code: 'functions/internal',
      message: 'MESSAGE_ID_ALREADY_EXISTS',
    };
    vi.mocked(callFn).mockRejectedValueOnce(error);

    await expect(deliverInboxMessage(base)).rejects.toBe(error);
    await expect(deliverInboxMessage(base)).resolves.toEqual(buildInboxMessage(base));
    expect(callFn).toHaveBeenCalledTimes(2);
  });

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

describe('5 秒內重複投遞守衛（A _claimRecentInboxDeliveryKey）', () => {
  it('同一把鍵 5 秒內只送一次；超過 5 秒可再送；Callable 失敗會釋放鍵', async () => {
    const first = await deliverInboxMessage(base);
    expect(first).not.toBeNull();
    expect(await deliverInboxMessage(base)).toBeNull();
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(await deliverInboxMessage({ ...base, now: new Date(NOW.getTime() + 6000) })).not.toBeNull();

    _resetRecentInboxDeliveryForTest();
    vi.mocked(callFn).mockRejectedValueOnce(new Error('boom'));
    await expect(deliverInboxMessage(base)).rejects.toThrow('boom');
    expect(await deliverInboxMessage(base)).not.toBeNull();
  });
});

