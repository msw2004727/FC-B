// adminMessages 讀寫：讀取預算（進頁 ≤ 54）、排程搶占／標記／退回都用 transaction。
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSdk, fakeState, limitOf, resetFakeFirestore, totalReads, type FakeDoc } from '../fake-firestore.test-helper';
import {
  ADMIN_MESSAGES_PAGE_SIZE,
  claimScheduledMessage,
  countAdminMessages,
  createAdminMessage,
  loadAdminMessagesPage,
  loadScheduledAdminMessages,
  markScheduledMessageSent,
  releaseScheduledMessageClaim,
  updateAdminMessageStatus,
} from './admin-messages-repo';

// 同步工廠（照 TeamManagePage.test）：假 SDK 由 vi.hoisted 先載入。
const fakeModule = await vi.hoisted(async () => import('../fake-firestore.test-helper'));
vi.mock('firebase/firestore', () => fakeModule.fakeSdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: { __db: true } }) }));

function docs(n: number, status = 'sent'): FakeDoc[] {
  return Array.from({ length: n }, (_, i) => ({ id: `d${i}`, data: { id: `mg_${i}`, title: `T${i}`, body: 'b', status } }));
}

beforeEach(() => {
  resetFakeFirestore();
});

describe('讀取預算', () => {
  it('第一頁：orderBy createdAt desc＋limit 50，讀 ≤ 50', async () => {
    fakeState.docsHandler = () => docs(ADMIN_MESSAGES_PAGE_SIZE);
    const page = await loadAdminMessagesPage();
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    const q = fakeState.reads[0]?.q;
    expect(q?.path).toBe('adminMessages');
    expect(q?.constraints.find((c) => c.type === 'orderBy')?.args).toEqual(['createdAt', 'desc']);
    expect(limitOf(q)).toBe(50);
    expect(totalReads()).toBeLessThanOrEqual(50);
  });

  it('載入更多帶 startAfter 游標，每次 ≤ 50', async () => {
    fakeState.docsHandler = () => docs(3);
    const first = await loadAdminMessagesPage();
    expect(first.hasMore).toBe(false);
    await loadAdminMessagesPage(first.cursor);
    const q = fakeState.reads[1]?.q;
    expect(q?.constraints.some((c) => c.type === 'startAfter')).toBe(true);
    expect(limitOf(q)).toBe(50);
  });

  it('計數：四個 count() 聚合（各 1 讀），排程含 processing', async () => {
    fakeState.countHandler = (q) => {
      const where = q.constraints.find((c) => c.type === 'where')?.args ?? [];
      if (where[1] === 'in') return 2;
      return where[2] === 'sent' ? 5 : where[2] === 'recalled' ? 1 : 0;
    };
    const counts = await countAdminMessages();
    expect(counts).toEqual({ sent: 5, scheduled: 2, recalled: 1, deleted: 0 });
    expect(fakeSdk.getCountFromServer).toHaveBeenCalledTimes(4);
    expect(fakeSdk.getDocs).not.toHaveBeenCalled();
    expect(totalReads()).toBe(4);
    const inWhere = fakeState.reads.map((r) => r.q?.constraints[0]?.args).find((a) => a?.[1] === 'in');
    expect(inWhere?.[2]).toEqual(['scheduled', 'processing']);
  });

  it('改狀態：0 讀 1 寫', async () => {
    await updateAdminMessageStatus('d1', 'recalled');
    expect(totalReads()).toBe(0);
    expect(fakeState.writes).toEqual([{ op: 'update', path: 'adminMessages/d1', data: { status: 'recalled' } }]);
  });

  it('排程檢查：where status == scheduled＋limit 20（單欄位索引）', async () => {
    fakeState.docsHandler = () => docs(2, 'scheduled');
    const list = await loadScheduledAdminMessages();
    expect(list).toHaveLength(2);
    const q = fakeState.reads[0]?.q;
    expect(q?.constraints.find((c) => c.type === 'where')?.args).toEqual(['status', '==', 'scheduled']);
    expect(q?.constraints.some((c) => c.type === 'orderBy')).toBe(false);
    expect(limitOf(q)).toBe(20);
  });
});

describe('寫入', () => {
  it('建立：文件 ID＝紀錄 id，補 createdAt', async () => {
    const saved = await createAdminMessage({ id: 'mg_1', title: 't', body: 'b', status: 'sent' });
    expect(saved._docId).toBe('mg_1');
    expect(fakeState.writes[0]).toMatchObject({ op: 'set', path: 'adminMessages/mg_1' });
    expect((fakeState.writes[0]?.data as Record<string, unknown>)['createdAt']).toEqual({ __serverTimestamp: true });
  });

  it('搶占：仍是 scheduled 且到期才改 processing', async () => {
    fakeState.txDoc = { status: 'scheduled', scheduledAt: '2026-11-08T09:00' };
    expect(await claimScheduledMessage('d1', 'U-admin', () => true)).toBe(true);
    expect(fakeState.writes[0]).toMatchObject({ op: 'tx.update', path: 'adminMessages/d1', data: { status: 'processing', processingBy: 'U-admin' } });

    fakeState.writes = [];
    fakeState.txDoc = { status: 'processing' };
    expect(await claimScheduledMessage('d1', 'U-admin', () => true)).toBe(false);
    fakeState.txDoc = { status: 'scheduled' };
    expect(await claimScheduledMessage('d1', 'U-admin', () => false)).toBe(false);
    fakeState.txDoc = null;
    expect(await claimScheduledMessage('d1', 'U-admin', () => true)).toBe(false);
    expect(fakeState.writes).toEqual([]);
  });

  // 測試同步更新：標記與退回改 transaction（只在仍是自己處理中時寫）、退回累計失敗次數；回收不再刪自己信箱副本（正式環境永遠空操作）。
  it('標記 sent：仍是自己處理中才寫，欄位照 A', async () => {
    fakeState.txDoc = { status: 'processing', processingBy: 'U-admin' };
    expect(await markScheduledMessageSent('d1', 'U-admin')).toBe(true);
    expect(fakeState.writes[0]).toMatchObject({ op: 'tx.update', path: 'adminMessages/d1' });
    expect(fakeState.writes[0]?.data).toMatchObject({ status: 'sent', processingAt: { __deleteField: true }, lastError: { __deleteField: true } });
  });

  it('標記 sent：已被取消、別人接手或不存在都不寫', async () => {
    for (const doc of [{ status: 'cancelled', processingBy: 'U-admin' }, { status: 'processing', processingBy: 'U-other' }, null]) {
      fakeState.txDoc = doc;
      expect(await markScheduledMessageSent('d1', 'U-admin')).toBe(false);
    }
    expect(fakeState.writes).toEqual([]);
  });

  it('退回：累計失敗次數，未滿 3 次回 scheduled 並寫 lastError', async () => {
    fakeState.txDoc = { status: 'processing', processingBy: 'U-admin' };
    expect(await releaseScheduledMessageClaim('d1', 'U-admin', new Error('boom'))).toBe('scheduled');
    expect(fakeState.writes[0]?.data).toMatchObject({ status: 'scheduled', lastError: 'boom', sendFailCount: 1, processingBy: { __deleteField: true } });
    fakeState.txDoc = { status: 'processing', processingBy: 'U-admin', sendFailCount: 1 };
    expect(await releaseScheduledMessageClaim('d1', 'U-admin', new Error('boom'))).toBe('scheduled');
    expect(fakeState.writes[1]?.data).toMatchObject({ status: 'scheduled', sendFailCount: 2 });
  });

  it('退回：第 3 次改 cancelled 並寫 lastError', async () => {
    fakeState.txDoc = { status: 'processing', processingBy: 'U-admin', sendFailCount: 2 };
    expect(await releaseScheduledMessageClaim('d1', 'U-admin', new Error('internal'))).toBe('cancelled');
    expect(fakeState.writes[0]?.data).toMatchObject({ status: 'cancelled', lastError: 'internal', sendFailCount: 3 });
  });

  it('退回：已被取消（不能改回 scheduled）或別人接手就不寫', async () => {
    fakeState.txDoc = { status: 'cancelled', processingBy: 'U-admin' };
    expect(await releaseScheduledMessageClaim('d1', 'U-admin', new Error('x'))).toBeNull();
    fakeState.txDoc = { status: 'processing', processingBy: 'U-other' };
    expect(await releaseScheduledMessageClaim('d1', 'U-admin', new Error('x'))).toBeNull();
    expect(fakeState.writes).toEqual([]);
  });
});
