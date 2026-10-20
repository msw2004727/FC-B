import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallFn, mockWriteOpLog } = vi.hoisted(() => ({
  mockCallFn: vi.fn(),
  mockWriteOpLog: vi.fn(),
}));

vi.mock('@/data/callables', async () => {
  const actual = await vi.importActual<typeof import('@/data/callables')>('@/data/callables');
  return {
    ...actual,
    callFn: mockCallFn,
  };
});

vi.mock('@/data/op-log', () => ({
  writeOpLog: mockWriteOpLog,
}));

import { CallableError } from '@/data/callables';
import {
  managerRemoveRegistration,
  REMOVE_PARTICIPANT_TIMEOUT_MESSAGE,
} from './roster-remove';
import type { OperateContext } from './operate-permissions';
import type { RosterRegistrationInput } from './attendance-roster-model';

const adminContext: OperateContext = {
  uid: 'u_admin',
  role: 'admin',
  rolePermissions: ['event.edit_all'],
  userGrants: null,
  capabilities: [],
  customRoles: [],
};

const noPermUserContext: OperateContext = {
  uid: 'u_stranger',
  role: 'user',
  rolePermissions: [],
  userGrants: null,
  capabilities: [],
  customRoles: [],
};

const delegateNoCapContext: OperateContext = {
  uid: 'u_delegate',
  role: 'user',
  rolePermissions: [],
  userGrants: null,
  capabilities: [],
  customRoles: [],
};

const sampleEvent = {
  id: 'ce_100',
  title: '週日友誼賽',
  creatorUid: 'u_owner',
  delegateUids: ['u_delegate'],
  privateEvent: false,
};

const sampleRegistrations: RosterRegistrationInput[] = [
  {
    _docId: 'reg_self_1',
    userId: 'u_player',
    userName: '王大明',
    status: 'confirmed',
    participantType: 'self',
  },
  {
    _docId: 'reg_comp_1',
    userId: 'u_player',
    userName: '王大明',
    companionId: 'comp_99',
    companionName: '小寶',
    status: 'confirmed',
    participantType: 'companion',
  },
  {
    _docId: 'reg_wait_1',
    userId: 'u_wait',
    userName: '候補阿哲',
    status: 'waitlisted',
    participantType: 'self',
  },
];

describe('managerRemoveRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteOpLog.mockResolvedValue(undefined);
    mockCallFn.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls cancelRegistration with reason=manager_remove, exact requestId format, and writes opLog on success', async () => {
    const res = await managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: {
        uid: 'u_player',
        name: '王大明',
        isCompanion: false,
      },
      registrations: sampleRegistrations,
      operatorUid: 'u_admin',
      operatorName: '總管A',
      context: adminContext,
      now: 1700000000123,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.regDocId).toBe('reg_self_1');
      expect(res.toastMessage).toBe('已將 王大明 從報名名單中移除');
    }
    expect(mockCallFn).toHaveBeenCalledTimes(1);
    expect(mockCallFn).toHaveBeenCalledWith('cancelRegistration', {
      eventId: 'ce_100',
      registrationIds: ['reg_self_1'],
      reason: 'manager_remove',
      requestId: 'remove_u_player_ce_100_1700000000123',
    });

    expect(mockWriteOpLog).toHaveBeenCalledTimes(1);
    expect(mockWriteOpLog).toHaveBeenCalledWith({
      type: 'participant_removed',
      typeName: '移除參加者',
      content: '從「週日友誼賽」移除 王大明',
      eventId: 'ce_100',
      actorUid: 'u_admin',
      operator: '總管A',
    });
  });

  it('uses companionId as uid in requestId when removing a companion registration', async () => {
    const res = await managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: {
        uid: 'comp_99',
        name: '小寶',
        isCompanion: true,
      },
      registrations: sampleRegistrations,
      operatorUid: 'u_admin',
      context: adminContext,
      now: 1700000000999,
    });

    expect(res.ok).toBe(true);
    expect(mockCallFn).toHaveBeenCalledWith('cancelRegistration', {
      eventId: 'ce_100',
      registrationIds: ['reg_comp_1'],
      reason: 'manager_remove',
      requestId: 'remove_comp_99_ce_100_1700000000999',
    });
  });

  it('rejects with 權限不足 and does not call callFn when confirmed permission is lacking', async () => {
    // user delegate without site_operate cannot remove confirmed, but can remove waitlisted
    const deniedConfirmed = await managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: {
        uid: 'u_player',
        name: '王大明',
        isCompanion: false,
      },
      registrations: sampleRegistrations,
      operatorUid: 'u_delegate',
      context: delegateNoCapContext,
    });

    expect(deniedConfirmed).toEqual({
      ok: false,
      reason: 'permission_denied',
      toastMessage: '權限不足',
    });
    expect(mockCallFn).not.toHaveBeenCalled();

    const allowedWaitlist = await managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: {
        uid: 'u_wait',
        name: '候補阿哲',
        isCompanion: false,
      },
      registrations: sampleRegistrations,
      operatorUid: 'u_delegate',
      context: delegateNoCapContext,
      now: 1700000000555,
    });
    expect(allowedWaitlist.ok).toBe(true);
    expect(mockCallFn).toHaveBeenCalledTimes(1);

    const deniedWaitlist = await managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: {
        uid: 'u_wait',
        name: '候補阿哲',
        isCompanion: false,
      },
      registrations: sampleRegistrations,
      operatorUid: 'u_stranger',
      context: noPermUserContext,
    });
    expect(deniedWaitlist).toEqual({
      ok: false,
      reason: 'permission_denied',
      toastMessage: '權限不足',
    });
  });

  it('returns 找不到對應的報名紀錄 when target registration does not exist', async () => {
    const res = await managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: {
        uid: 'u_non_existent',
        name: '不存在的人',
        isCompanion: false,
      },
      registrations: sampleRegistrations,
      operatorUid: 'u_admin',
      context: adminContext,
    });

    expect(res).toEqual({
      ok: false,
      reason: 'not_found',
      toastMessage: '找不到對應的報名紀錄',
    });
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('maps CF error codes to friendly Chinese messages matching A cfMsg', async () => {
    const cases: Array<[CallableError, string]> = [
      [
        new CallableError('failed-precondition', 'ALREADY_CANCELLED', { code: 'ALREADY_CANCELLED' }),
        '移除失敗：已取消此報名',
      ],
      [
        new CallableError('not-found', 'REG_NOT_FOUND', { code: 'REG_NOT_FOUND' }),
        '移除失敗：找不到報名紀錄',
      ],
      [
        new CallableError('not-found', 'EVENT_NOT_FOUND', { code: 'EVENT_NOT_FOUND' }),
        '移除失敗：活動不存在',
      ],
      [
        new CallableError('permission-denied', 'forbidden', { code: 'PERMISSION_DENIED' }),
        '移除失敗：無權限執行此操作',
      ],
      [
        new CallableError('unavailable', 'network fetch failed'),
        '移除失敗：連線逾時，請檢查網路後重新整理再試',
      ],
    ];

    for (const [err, expectedMsg] of cases) {
      mockCallFn.mockRejectedValueOnce(err);
      const res = await managerRemoveRegistration({
        eventId: 'ce_100',
        event: sampleEvent,
        registration: { uid: 'u_player', name: '王大明', isCompanion: false },
        registrations: sampleRegistrations,
        operatorUid: 'u_admin',
        context: adminContext,
      });
      expect(res.ok).toBe(false);
      expect(res.toastMessage).toBe(expectedMsg);
    }
    expect(mockWriteOpLog).not.toHaveBeenCalled();
  });

  it('times out after 15 seconds with 移除操作逾時，請重新整理後再試', async () => {
    vi.useFakeTimers();
    mockCallFn.mockImplementation(
      () => new Promise(() => {
        // never resolves
      }),
    );

    const promise = managerRemoveRegistration({
      eventId: 'ce_100',
      event: sampleEvent,
      registration: { uid: 'u_player', name: '王大明', isCompanion: false },
      registrations: sampleRegistrations,
      operatorUid: 'u_admin',
      context: adminContext,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    const res = await promise;

    expect(res.ok).toBe(false);
    expect(res.toastMessage).toContain(REMOVE_PARTICIPANT_TIMEOUT_MESSAGE);
    expect(mockWriteOpLog).not.toHaveBeenCalled();
  });
});
