import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({
    kind: 'doc',
    coll,
    id,
  })),
  updateDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __fakeDb: true } })),
}));

vi.mock('@/data/notify', () => ({
  sendTemplateNotification: vi.fn(async () => ({ delivered: true, linePushed: false })),
}));

vi.mock('./event-change-notify', () => ({
  loadEventNotifyRecipientUids: vi.fn(async () => []),
}));

vi.mock('./event-detail', () => ({
  loadEventRegistrations: vi.fn(async () => []),
}));

import { setDoc, updateDoc } from 'firebase/firestore';

import { sendTemplateNotification } from '@/data/notify';
import { createGuestViewer, type ViewerView } from '@/features/profile/data/viewer';

import { loadEventNotifyRecipientUids } from './event-change-notify';
import { loadEventRegistrations } from './event-detail';
import {
  NOTIFY_CONCURRENCY,
  NOTIFY_PARALLEL_MAX_RECIPIENTS,
  cancelEvent,
  isCourseLinkedLifecycleLocked,
  isEventStartPassed,
  relistEvent,
  reopenEvent,
} from './event-lifecycle';
import type { EventDoc, RegistrationDoc } from './types';

const mockUpdateDoc = vi.mocked(updateDoc);
const mockSetDoc = vi.mocked(setDoc);
const mockSendNotify = vi.mocked(sendTemplateNotification);
const mockLoadRecipients = vi.mocked(loadEventNotifyRecipientUids);
const mockLoadRegs = vi.mocked(loadEventRegistrations);

function ev(overrides: Record<string, unknown> = {}): EventDoc {
  return {
    id: 'evt-1',
    title: 'X',
    status: 'open',
    creatorUid: 'u1',
    ...overrides,
  } as unknown as EventDoc;
}

function reg(overrides: Record<string, unknown> = {}): RegistrationDoc {
  return { status: 'confirmed', ...overrides } as unknown as RegistrationDoc;
}

function adminViewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'u1',
    teamIds: new Set<string>(),
    hasPermission: () => true,
    roleLevel: 4,
    role: 'admin',
    displayName: '管理員甲',
    pictureUrl: null,
    capabilities: [],
    permissionSources: {
      rolePermissions: null,
      userGrants: [],
      customRoles: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockUpdateDoc.mockReset();
  mockUpdateDoc.mockResolvedValue(undefined);

  mockSetDoc.mockReset();
  mockSetDoc.mockResolvedValue(undefined);

  mockSendNotify.mockReset();
  mockSendNotify.mockResolvedValue({ delivered: true, linePushed: false });

  mockLoadRecipients.mockReset();
  mockLoadRecipients.mockResolvedValue([]);

  mockLoadRegs.mockReset();
  mockLoadRegs.mockResolvedValue([]);

});

// ── isCourseLinkedLifecycleLocked ─────────────────────

describe('isCourseLinkedLifecycleLocked', () => {
  it('returns true when courseLinked === true', () => {
    expect(isCourseLinkedLifecycleLocked(ev({ courseLinked: true }))).toBe(true);
  });

  it('returns true when courseLinkId is non-empty', () => {
    expect(isCourseLinkedLifecycleLocked(ev({ courseLinkId: 'link-1' }))).toBe(true);
  });

  it('returns true when courseLinkSource / source === "eduCourseLesson"', () => {
    expect(isCourseLinkedLifecycleLocked(ev({ courseLinkSource: 'eduCourseLesson' }))).toBe(true);
    expect(isCourseLinkedLifecycleLocked(ev({ source: 'eduCourseLesson' }))).toBe(true);
  });

  it('returns false for plain events', () => {
    expect(isCourseLinkedLifecycleLocked(ev())).toBe(false);
    expect(isCourseLinkedLifecycleLocked(ev({ source: 'manual' }))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isCourseLinkedLifecycleLocked(null)).toBe(false);
    expect(isCourseLinkedLifecycleLocked(undefined)).toBe(false);
  });
});

// ── cancelEvent ───────────────────────────────────────

describe('cancelEvent', () => {
  it('writes status=cancelled + updatedAt, notifies recipients, and writes op log', async () => {
    mockLoadRecipients.mockResolvedValue(['u1', 'u2']);

    const now = new Date(Date.parse('2026-05-09T10:00:00+08:00'));
    await cancelEvent({
      event: ev({ title: '晨跑', date: '2099/06/01 07:00~09:00', location: '公園' }),
      eventDocId: 'doc-1',
      viewer: adminViewer(),
      now,
    });

    // Write
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [eventRef, payload] = mockUpdateDoc.mock.calls[0]!;
    const refShape = eventRef as unknown as { coll: string; id: string };
    expect(refShape.coll).toBe('events');
    expect(refShape.id).toBe('doc-1');
    const data = payload as unknown as Record<string, unknown>;
    expect(data.status).toBe('cancelled');
    expect(data.updatedAt).toEqual({ __serverTimestamp: true });

    // Notifications
    expect(mockSendNotify).toHaveBeenCalledTimes(2);
    for (const [i, expectedUid] of (['u1', 'u2'] as const).entries()) {
      const call = mockSendNotify.mock.calls[i]![0];
      expect(call.key).toBe('event_cancelled');
      expect(call.targetUid).toBe(expectedUid);
      expect(call.category).toBe('activity');
      expect(call.categoryName).toBe('活動');
      expect(call.senderUid).toBe('u1');
      expect(call.vars).toEqual({
        eventName: '晨跑',
        date: '2099/06/01 07:00~09:00',
        location: '公園',
      });
    }

    // Op log
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [logRef, logPayload, logOptions] = mockSetDoc.mock.calls[0]!;
    const logRefShape = logRef as unknown as { coll: string; id: string };
    expect(logRefShape.coll).toBe('operationLogs');
    expect(logRefShape.id).toMatch(/^op_\d+_[a-z0-9]{1,6}$/);
    const logData = logPayload as unknown as Record<string, unknown>;
    expect(logData.type).toBe('event_cancel');
    expect(logData.typeName).toBe('取消活動');
    expect(logData.content).toBe('取消「晨跑」');
    expect(logData.eventId).toBe('evt-1');
    expect(logData.actorUid).toBe('u1');
    expect(logData.operator).toBe('管理員甲');
    expect(logData.time).toBe('05/09 10:00');
    expect(logOptions).toEqual({ merge: true });
  });

  it('throws COURSE_LINKED for course-linked events', async () => {
    await expect(
      cancelEvent({
        event: ev({ courseLinked: true }),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'COURSE_LINKED' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSendNotify).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws NOT_ALLOWED when viewer cannot cancel', async () => {
    await expect(
      cancelEvent({
        event: ev({ creatorUid: 'other' }),
        eventDocId: 'doc-1',
        viewer: createGuestViewer(),
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('throws WRITE_FAILED when updateDoc rejects', async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error('boom'));
    await expect(
      cancelEvent({
        event: ev(),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(mockSendNotify).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('succeeds even if one notification fails', async () => {
    mockLoadRecipients.mockResolvedValue(['u1', 'u2']);
    mockSendNotify
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ delivered: true, linePushed: false });

    await cancelEvent({
      event: ev(),
      eventDocId: 'doc-1',
      viewer: adminViewer(),
      now: new Date(),
    });

    expect(mockSendNotify).toHaveBeenCalledTimes(2);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('succeeds when loading recipients fails', async () => {
    mockLoadRecipients.mockRejectedValueOnce(new Error('net'));
    await cancelEvent({
      event: ev(),
      eventDocId: 'doc-1',
      viewer: adminViewer(),
      now: new Date(),
    });
    expect(mockSendNotify).not.toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });
});

// ── 通知小批並行（11-12：≤100 人一次 5 人，>100 人逐人，避開一般層每分鐘上限） ──

describe('cancelEvent 通知小批並行', () => {
  type Result = Awaited<ReturnType<typeof sendTemplateNotification>>;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  };
  const uids = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i}`);
  /** 每次呼叫回傳一個可手動完成的 Promise，並記錄同時進行中的最大數。 */
  function controllableNotify() {
    const pending: Array<{ uid: string; resolve(): void; reject(e: unknown): void }> = [];
    const state = { inFlight: 0, maxInFlight: 0 };
    mockSendNotify.mockImplementation((input) => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      return new Promise<Result>((resolve, reject) => {
        pending.push({
          uid: input.targetUid,
          resolve: () => { state.inFlight -= 1; resolve({ delivered: true, linePushed: false }); },
          reject: (e) => { state.inFlight -= 1; reject(e); },
        });
      });
    });
    return { pending, state };
  }

  it('門檻常數：一次 5 人、100 人以內才並行', () => {
    expect(NOTIFY_CONCURRENCY).toBe(5);
    expect(NOTIFY_PARALLEL_MAX_RECIPIENTS).toBe(100);
  });

  it('10 人：同時最多 5 人、每人一次；單人失敗其餘照送；全部完成後才寫操作日誌', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const list = uids(10);
      mockLoadRecipients.mockResolvedValue(list);
      const { pending, state } = controllableNotify();
      let done = false;
      const running = cancelEvent({ event: ev(), eventDocId: 'doc-1', viewer: adminViewer(), now: new Date() })
        .then(() => { done = true; });

      await flush();
      expect(mockSendNotify).toHaveBeenCalledTimes(5);
      expect(state.inFlight).toBe(5);
      expect(mockSetDoc).not.toHaveBeenCalled();

      // 第一批：第 2 人失敗，其餘成功；同批未全部結束前不送下一批。
      const failure = new Error('net');
      pending[0]!.resolve();
      pending[1]!.reject(failure);
      pending[2]!.resolve();
      pending[3]!.resolve();
      await flush();
      expect(mockSendNotify).toHaveBeenCalledTimes(5);
      pending[4]!.resolve();
      await flush();
      expect(mockSendNotify).toHaveBeenCalledTimes(10);
      expect(mockSetDoc).not.toHaveBeenCalled();

      for (const item of pending.slice(5, 9)) item.resolve();
      await flush();
      // 最後一人還沒完成：仍不寫操作日誌、cancelEvent 未結束。
      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(done).toBe(false);

      pending[9]!.resolve();
      await running;
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(state.maxInFlight).toBe(5);
      expect(mockSendNotify.mock.calls.map(([input]) => input.targetUid)).toEqual(list);
      // 失敗處理同舊版：只 warn（同樣的訊息與欄位），不往外拋。
      expect(warn).toHaveBeenCalledWith('[event-lifecycle] notify failed', {
        templateKey: 'event_cancelled',
        uid: 'r1',
        err: failure,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('101 人（超過門檻）：退回逐人送，同時最多 1 人、每人一次', async () => {
    const list = uids(NOTIFY_PARALLEL_MAX_RECIPIENTS + 1);
    mockLoadRecipients.mockResolvedValue(list);
    const state = { inFlight: 0, maxInFlight: 0 };
    mockSendNotify.mockImplementation(async () => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await Promise.resolve();
      await Promise.resolve();
      state.inFlight -= 1;
      return { delivered: true, linePushed: false };
    });

    await cancelEvent({ event: ev(), eventDocId: 'doc-1', viewer: adminViewer(), now: new Date() });

    expect(state.maxInFlight).toBe(1);
    expect(mockSendNotify).toHaveBeenCalledTimes(list.length);
    expect(mockSendNotify.mock.calls.map(([input]) => input.targetUid)).toEqual(list);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('剛好 100 人：仍並行（同時最多 5 人）', async () => {
    const list = uids(NOTIFY_PARALLEL_MAX_RECIPIENTS);
    mockLoadRecipients.mockResolvedValue(list);
    const state = { inFlight: 0, maxInFlight: 0 };
    mockSendNotify.mockImplementation(async () => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await Promise.resolve();
      state.inFlight -= 1;
      return { delivered: true, linePushed: false };
    });

    await cancelEvent({ event: ev(), eventDocId: 'doc-1', viewer: adminViewer(), now: new Date() });

    expect(state.maxInFlight).toBe(5);
    expect(new Set(mockSendNotify.mock.calls.map(([input]) => input.targetUid)).size).toBe(100);
    expect(mockSendNotify).toHaveBeenCalledTimes(100);
  });
});

// ── reopenEvent ───────────────────────────────────────

describe('reopenEvent', () => {
  it('writes status=open when not full and does not notify', async () => {
    mockLoadRegs.mockResolvedValue([reg({ _docId: 'r1' })]);
    await reopenEvent({
      event: ev({
        date: '2099/06/01 10:00',
        status: 'cancelled',
        max: 10,
      } as Record<string, unknown>),
      eventDocId: 'doc-1',
      viewer: adminViewer(),
      now: new Date(Date.parse('2026-05-09T00:00:00+08:00')),
    });
    const [, payload] = mockUpdateDoc.mock.calls[0]!;
    const data = payload as unknown as Record<string, unknown>;
    expect(data.status).toBe('open');
    expect(data.updatedAt).toEqual({ __serverTimestamp: true });
    expect(mockSendNotify).not.toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const logData = mockSetDoc.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(logData.type).toBe('event_reopen');
    expect(logData.typeName).toBe('重開活動');
    expect(logData.content).toBe('重開「X」');
  });

  it('writes status=full when registrations make it truly full', async () => {
    mockLoadRegs.mockResolvedValue([
      reg({ _docId: 'r1', userId: 'u-1', userName: '甲' }),
      reg({ _docId: 'r2', userId: 'u-2', userName: '乙' }),
    ]);
    await reopenEvent({
      event: ev({
        date: '2099/06/01 10:00',
        status: 'cancelled',
        max: 2,
      } as Record<string, unknown>),
      eventDocId: 'doc-1',
      viewer: adminViewer(),
      now: new Date(Date.parse('2026-05-09T00:00:00+08:00')),
    });
    const data = mockUpdateDoc.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(data.status).toBe('full');
  });

  it('throws START_PASSED when start date has passed', async () => {
    await expect(
      reopenEvent({
        event: ev({ date: '2026/05/09 09:00', status: 'cancelled' }),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(Date.parse('2026-05-09T10:00:00+08:00')),
      }),
    ).rejects.toMatchObject({ code: 'START_PASSED' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockLoadRegs).not.toHaveBeenCalled();
  });

  it('throws COURSE_LINKED before permission check', async () => {
    await expect(
      reopenEvent({
        event: ev({ courseLinkId: 'link-1' }),
        eventDocId: 'doc-1',
        viewer: createGuestViewer(),
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'COURSE_LINKED' });
  });

  it('throws NOT_ALLOWED when viewer cannot reopen', async () => {
    await expect(
      reopenEvent({
        event: ev({ date: '2099/06/01 10:00' }),
        eventDocId: 'doc-1',
        viewer: createGuestViewer(),
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('throws WRITE_FAILED when updateDoc rejects', async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error('boom'));
    await expect(
      reopenEvent({
        event: ev({ date: '2099/06/01 10:00' }),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(Date.parse('2026-05-09T00:00:00+08:00')),
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

// ── relistEvent ───────────────────────────────────────

describe('relistEvent', () => {
  it('writes status, notifies event_relisted, and writes op log', async () => {
    mockLoadRecipients.mockResolvedValue(['u1', 'u2']);
    mockLoadRegs.mockResolvedValue([reg({ _docId: 'r1' })]);

    await relistEvent({
      event: ev({
        date: '2099/06/01 10:00',
        location: '公園',
        status: 'ended',
        max: 10,
      } as Record<string, unknown>),
      eventDocId: 'doc-1',
      viewer: adminViewer(),
      now: new Date(Date.parse('2026-05-09T00:00:00+08:00')),
    });

    const data = mockUpdateDoc.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(data.status).toBe('open');
    expect(data.updatedAt).toEqual({ __serverTimestamp: true });

    expect(mockSendNotify).toHaveBeenCalledTimes(2);
    const first = mockSendNotify.mock.calls[0]![0];
    expect(first.key).toBe('event_relisted');
    expect(first.category).toBe('activity');
    expect(first.categoryName).toBe('活動');

    const logData = mockSetDoc.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(logData.type).toBe('event_relist');
    expect(logData.typeName).toBe('重新上架');
    expect(logData.content).toBe('重新上架「X」');
  });

  it('throws START_PASSED when start date has passed', async () => {
    await expect(
      relistEvent({
        event: ev({ date: '2026/05/09 09:00', status: 'ended' }),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(Date.parse('2026-05-09T10:00:00+08:00')),
      }),
    ).rejects.toMatchObject({ code: 'START_PASSED' });
  });

  it('throws WRITE_FAILED and skips notifications when write fails', async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error('boom'));
    await expect(
      relistEvent({
        event: ev({ date: '2099/06/01 10:00', status: 'ended' }),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(Date.parse('2026-05-09T00:00:00+08:00')),
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(mockSendNotify).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('T-054c L1 起點邊界', () => {
  for (const [name, operate] of [['reopenEvent', reopenEvent], ['relistEvent', relistEvent]] as const) {
    it(`${name} 起點當下拒絕 START_PASSED，前 1ms 通過`, async () => {
      const input = {
        event: ev({ id: 'evtA', creatorUid: 'uidA', date: '2026/10/19 11:00~13:00', max: 10 }),
        eventDocId: 'evtA',
        viewer: adminViewer({ uid: 'uidA' }),
      };
      await expect(operate({ ...input, now: new Date('2026-10-19T11:00:00+08:00') }))
        .rejects.toMatchObject({ code: 'START_PASSED' });
      expect(mockUpdateDoc).not.toHaveBeenCalled();
      expect(mockLoadRegs).not.toHaveBeenCalled();
      await expect(operate({ ...input, now: new Date('2026-10-19T10:59:59.999+08:00') })).resolves.toBeUndefined();
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });
  }

  it('L1 消費端保留 ISO／非字串日期不判開始已過', () => {
    for (const date of ['2000-01-01T00:00:00+08:00', Date.parse('2000-01-01T00:00:00+08:00')]) {
      expect(isEventStartPassed(ev({ id: 'evtA', date }), new Date('2026-10-19T11:00:00+08:00'))).toBe(false);
    }
  });
});
