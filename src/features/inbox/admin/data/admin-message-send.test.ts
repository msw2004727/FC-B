// 站內信投遞與 LINE 推播（站長 2026-11-02 Q2）：全體只送站內信；指定用戶／俱樂部／角色照送，條件查詢＋上限；不讀 users 全集合。
// 只用 mock 的 Callable，不送真推播。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetRecentInboxDeliveryForTest } from '@/data/inbox-delivery';

import { fakeSdk, fakeState, limitOf, resetFakeFirestore, totalReads, type FakeDoc } from '../fake-firestore.test-helper';
import type { AdminMessage } from './admin-message-model';
import { LINE_PUSH_ROLE_LIMIT, LINE_PUSH_TEAM_LIMIT, deliverAdminMessage, queueLinePushByTarget } from './admin-message-send';

const callFn = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', async () => (await import('../fake-firestore.test-helper')).fakeSdk);
// 非同步 mock 工廠先解析一次，避免頁面同時動態載入兩次時拿到真的 SDK。
beforeAll(async () => {
  await import('firebase/firestore');
});
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: { __db: true } }) }));
vi.mock('@/data/callables', () => ({ callFn }));

function msg(over: Partial<AdminMessage>): AdminMessage {
  return {
    _docId: 'mg_1',
    id: 'mg_1',
    title: '公告',
    body: '內容',
    category: 'system',
    categoryName: '系統',
    senderName: '站長',
    status: 'sent',
    targetType: 'all',
    ...over,
  };
}

function users(n: number, prefix = 'U'): FakeDoc[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, data: { uid: `${prefix}${i}` } }));
}

function lineCalls(): unknown[] {
  return callFn.mock.calls.filter((c) => c[0] === 'enqueuePrivilegedLineNotification').map((c) => c[1]);
}

beforeEach(() => {
  resetFakeFirestore();
  callFn.mockReset();
  callFn.mockResolvedValue({ queued: true });
  _resetRecentInboxDeliveryForTest();
});

describe('deliverAdminMessage（A _deliverMessageToInbox 的 extra）', () => {
  it('群發：targetUid null，帶 adminMsgId／targetType／targetRoles', async () => {
    await deliverAdminMessage(msg({ targetType: 'coach', targetRoles: ['coach', 'admin', 'super_admin'] }), 'U-admin');
    expect(callFn).toHaveBeenCalledTimes(1);
    const [name, req] = callFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('deliverToInbox');
    expect(req['targetUid']).toBeNull();
    expect(req['targetType']).toBe('coach');
    expect(req['targetRoles']).toEqual(['coach', 'admin', 'super_admin']);
    const message = req['message'] as Record<string, unknown>;
    expect(message).toMatchObject({ adminMsgId: 'mg_1', title: '公告', body: '內容', type: 'system', typeName: '系統', senderName: '站長' });
  });

  it('投遞失敗往外拋（呼叫端提示或退回排程）', async () => {
    callFn.mockRejectedValueOnce(new Error('internal'));
    await expect(deliverAdminMessage(msg({}), 'U-admin')).rejects.toThrow('internal');
  });
});

describe('LINE 推播名單與讀取預算', () => {
  it('全體用戶：不推 LINE、不讀 users', async () => {
    expect(await queueLinePushByTarget(msg({ targetType: 'all' }))).toEqual({ status: 'none' });
    expect(lineCalls()).toHaveLength(0);
    expect(totalReads()).toBe(0);
  });

  it('指定用戶：直接推 1 人、0 讀；source＝target:individual', async () => {
    const out = await queueLinePushByTarget(msg({ targetType: 'individual', targetUid: 'U9' }));
    expect(out).toEqual({ status: 'queued', total: 1, failed: 0 });
    expect(lineCalls()).toEqual([{ uid: 'U9', category: 'system', title: '公告', body: '內容', source: 'target:individual' }]);
    expect(totalReads()).toBe(0);
  });

  it('指定俱樂部：teamIds array-contains＋teamId ==，各 limit 200、去重', async () => {
    fakeState.docsHandler = (q) => {
      const field = q.constraints.find((c) => c.type === 'where')?.args[0];
      return field === 'teamIds' ? users(3) : [{ id: 'U1', data: { uid: 'U1' } }, { id: 'L9', data: { uid: 'L9' } }];
    };
    const out = await queueLinePushByTarget(msg({ targetType: 'team', targetTeamId: 'tm_1' }));
    expect(out).toEqual({ status: 'queued', total: 4, failed: 0 });
    const wheres = fakeState.reads.map((r) => r.q?.constraints.find((c) => c.type === 'where')?.args);
    expect(wheres).toEqual([['teamIds', 'array-contains', 'tm_1'], ['teamId', '==', 'tm_1']]);
    for (const r of fakeState.reads) {
      expect(r.path).toBe('users');
      expect(limitOf(r.q)).toBe(LINE_PUSH_TEAM_LIMIT);
    }
    expect(totalReads()).toBeLessThanOrEqual(LINE_PUSH_TEAM_LIMIT * 2);
  });

  it('指定俱樂部讀到上限：整批不推、回報上限', async () => {
    fakeState.docsHandler = (q) => (q.constraints.some((c) => c.args[0] === 'teamIds') ? users(LINE_PUSH_TEAM_LIMIT) : []);
    expect(await queueLinePushByTarget(msg({ targetType: 'team', targetTeamId: 'tm_1' }))).toEqual({ status: 'overLimit', limit: 200 });
    expect(lineCalls()).toHaveLength(0);
  });

  it('角色群發：users where role in [...] limit 500；source＝target:<targetType>', async () => {
    fakeState.docsHandler = () => users(12);
    const out = await queueLinePushByTarget(msg({ targetType: 'coach_up', category: 'activity' }));
    expect(out).toEqual({ status: 'queued', total: 12, failed: 0 });
    const q = fakeState.reads[0]?.q;
    expect(q?.constraints.find((c) => c.type === 'where')?.args).toEqual(['role', 'in', ['coach', 'captain', 'venue_owner', 'admin', 'super_admin']]);
    expect(limitOf(q)).toBe(LINE_PUSH_ROLE_LIMIT);
    expect(lineCalls()).toHaveLength(12);
    expect(lineCalls()[0]).toMatchObject({ category: 'activity', source: 'target:coach_up' });
    expect(totalReads()).toBeLessThanOrEqual(LINE_PUSH_ROLE_LIMIT);
  });

  it('角色群發讀到 500：整批不推', async () => {
    fakeState.docsHandler = () => users(LINE_PUSH_ROLE_LIMIT);
    expect(await queueLinePushByTarget(msg({ targetType: 'admin' }))).toEqual({ status: 'overLimit', limit: 500 });
    expect(lineCalls()).toHaveLength(0);
  });

  it('單人推播失敗只計數，不往外拋', async () => {
    fakeState.docsHandler = () => users(3);
    callFn.mockImplementation(async (_name: string, req: { uid: string }) => {
      if (req.uid === 'U1') throw new Error('resource-exhausted');
      return { queued: true };
    });
    expect(await queueLinePushByTarget(msg({ targetType: 'admin' }))).toEqual({ status: 'queued', total: 3, failed: 1 });
  });

  it('從不使用 collectionGroup，也不讀無條件的 users 全集合', async () => {
    fakeState.docsHandler = () => users(2);
    for (const targetType of ['all', 'coach', 'captain', 'venue_owner', 'coach_up', 'admin', 'team', 'individual']) {
      await queueLinePushByTarget(msg({ targetType, targetTeamId: 'tm_1', targetUid: 'U9' }));
    }
    expect(fakeSdk.collectionGroup).not.toHaveBeenCalled();
    for (const r of fakeState.reads) {
      expect(r.q?.constraints.some((c) => c.type === 'where')).toBe(true);
      expect(limitOf(r.q)).not.toBeNull();
    }
  });
});
