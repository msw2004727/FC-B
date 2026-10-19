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

vi.mock('@/data/internal-test', () => ({
  assertInternalTestEventTitle: vi.fn(),
  InternalTestBlockedError: class InternalTestBlockedError extends Error {
    code: 'INTERNAL_TEST_EVENT_ONLY' | 'INTERNAL_TEST_BLOCKED';
    messageKey: 'internalTest.eventOnly' | 'internalTest.blocked';
    constructor(kind: 'event' | 'team' | 'pm' | 'inbox' | 'line' = 'event') {
      super(
        kind === 'event'
          ? '內測期間只能操作標題以「[內測]」開頭的活動'
          : `內測期間不能對內測名單以外的使用者操作（${kind}）`,
      );
      this.name = 'InternalTestBlockedError';
      this.code = kind === 'event' ? 'INTERNAL_TEST_EVENT_ONLY' : 'INTERNAL_TEST_BLOCKED';
      this.messageKey = kind === 'event' ? 'internalTest.eventOnly' : 'internalTest.blocked';
    }
  },
}));

import { setDoc, updateDoc } from 'firebase/firestore';

import { assertInternalTestEventTitle, InternalTestBlockedError } from '@/data/internal-test';
import { sendTemplateNotification } from '@/data/notify';
import { createGuestViewer, type ViewerView } from '@/features/profile/data/viewer';

import { loadEventNotifyRecipientUids } from './event-change-notify';
import { loadEventRegistrations } from './event-detail';
import {
  cancelEvent,
  isCourseLinkedLifecycleLocked,
  relistEvent,
  reopenEvent,
} from './event-lifecycle';
import type { EventDoc, RegistrationDoc } from './types';

const mockUpdateDoc = vi.mocked(updateDoc);
const mockSetDoc = vi.mocked(setDoc);
const mockSendNotify = vi.mocked(sendTemplateNotification);
const mockLoadRecipients = vi.mocked(loadEventNotifyRecipientUids);
const mockLoadRegs = vi.mocked(loadEventRegistrations);
const mockAssertInternalTest = vi.mocked(assertInternalTestEventTitle);

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

  mockAssertInternalTest.mockReset();
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

    const now = new Date(2026, 4, 9, 10, 0);
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

  it('throws InternalTestBlockedError as-is', async () => {
    mockAssertInternalTest.mockImplementationOnce(() => {
      throw new InternalTestBlockedError('event');
    });
    await expect(
      cancelEvent({
        event: ev(),
        eventDocId: 'doc-1',
        viewer: adminViewer(),
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(InternalTestBlockedError);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
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
      now: new Date(2026, 4, 9),
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
      now: new Date(2026, 4, 9),
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
        now: new Date(2026, 4, 9, 10, 0),
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
        now: new Date(2026, 4, 9),
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
      now: new Date(2026, 4, 9),
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
        now: new Date(2026, 4, 9, 10, 0),
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
        now: new Date(2026, 4, 9),
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(mockSendNotify).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
