/** 留言新增、回覆與刪除寫入進行中要擋住強制更新，成功與失敗都釋放。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ getFirebase: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn() }));
vi.mock('@/data/firebase', () => ({ getFirebase: mock.getFirebase }));
vi.mock('firebase/firestore', () => ({
  collection: (parent: { path?: string }, ...parts: string[]) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') }),
  doc: (parent: { path?: string }, ...parts: string[]) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') }),
  serverTimestamp: () => 'server-time',
  addDoc: mock.addDoc,
  updateDoc: mock.updateDoc,
}));

import { _resetSubmitGuardForTest, isSubmitting, onSubmittingIdle } from '@/core/submit-guard';
import {
  deleteEventComment, mapComment, submitEventComment, submitEventCommentReply,
  _resetEventCommentsForTest, type CommentContext,
} from './event-comments';

const context: CommentContext = {
  event: { id: 'public-event', creatorUid: 'host', date: '2099/01/01 10:00~11:00' },
  eventDocId: 'doc',
  viewer: { uid: 'host', displayName: '主辦', pictureUrl: '', roleLevel: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  _resetEventCommentsForTest();
  _resetSubmitGuardForTest();
  mock.getFirebase.mockResolvedValue({ db: {} });
});

describe('留言寫入送出中', () => {
  it('新增留言：addDoc 進行中為 true，成功後釋放', async () => {
    let resolve!: (value: unknown) => void;
    mock.addDoc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const operation = submitEventComment(context, '你好', false);
    await vi.waitFor(() => expect(mock.addDoc).toHaveBeenCalledTimes(1));
    expect(isSubmitting()).toBe(true);
    resolve({});
    await expect(operation).resolves.toBeUndefined();
    expect(isSubmitting()).toBe(false);
  });

  it('新增留言：addDoc 丟錯後也釋放', async () => {
    mock.addDoc.mockRejectedValue(new Error('offline'));
    await expect(submitEventComment(context, '你好', false)).rejects.toThrow('offline');
    expect(isSubmitting()).toBe(false);
  });

  it('刪除留言：updateDoc 進行中為 true，成功與丟錯後都釋放', async () => {
    let resolve!: () => void;
    mock.updateDoc.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const operation = deleteEventComment(context, 'c1');
    await vi.waitFor(() => expect(mock.updateDoc).toHaveBeenCalledTimes(1));
    expect(isSubmitting()).toBe(true);
    resolve();
    await expect(operation).resolves.toBeUndefined();
    expect(isSubmitting()).toBe(false);

    mock.updateDoc.mockRejectedValue(new Error('denied'));
    await expect(deleteEventComment(context, 'c1')).rejects.toThrow('denied');
    expect(isSubmitting()).toBe(false);
  });
  it.each([
    ['新增留言', () => submitEventComment(context, '你好', false)],
    ['回覆留言', () => submitEventCommentReply(context, mapComment('c1', {}, 'host'), '回覆')],
  ] as const)('%s：permission-denied 重送期間不歸零，完成後只釋放一次', async (_name, run) => {
    const idle = vi.fn();
    onSubmittingIdle(idle);
    let resolve!: (value: unknown) => void;
    const seen: boolean[] = [];
    mock.addDoc
      .mockImplementationOnce(async () => {
        seen.push(isSubmitting());
        throw { code: 'permission-denied' };
      })
      .mockImplementationOnce(() => {
        seen.push(isSubmitting());
        return new Promise((r) => { resolve = r; });
      });
    const operation = run();
    await vi.waitFor(() => expect(mock.addDoc).toHaveBeenCalledTimes(2));
    expect(seen).toEqual([true, true]);
    expect(isSubmitting()).toBe(true);
    expect(idle).not.toHaveBeenCalled();
    resolve({});
    await expect(operation).resolves.toBeUndefined();
    expect(isSubmitting()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['新增留言', () => submitEventComment(context, '你好', false)],
    ['回覆留言', () => submitEventCommentReply(context, mapComment('c1', {}, 'host'), '回覆')],
  ] as const)('%s：permission-denied 重送也失敗時釋放', async (_name, run) => {
    mock.addDoc
      .mockRejectedValueOnce({ code: 'permission-denied' })
      .mockRejectedValueOnce(new Error('legacy failed'));
    await expect(run()).rejects.toThrow('legacy failed');
    expect(mock.addDoc).toHaveBeenCalledTimes(2);
    expect(isSubmitting()).toBe(false);
  });

  it('回覆留言：addDoc 進行中為 true，成功與丟錯後都釋放', async () => {
    let resolve!: (value: unknown) => void;
    mock.addDoc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const operation = submitEventCommentReply(context, mapComment('c1', {}, 'host'), '回覆');
    await vi.waitFor(() => expect(mock.addDoc).toHaveBeenCalledTimes(1));
    expect(isSubmitting()).toBe(true);
    resolve({});
    await expect(operation).resolves.toBeUndefined();
    expect(isSubmitting()).toBe(false);

    mock.addDoc.mockRejectedValue(new Error('offline'));
    await expect(submitEventCommentReply(context, mapComment('c1', {}, 'host'), '回覆')).rejects.toThrow('offline');
    expect(isSubmitting()).toBe(false);
  });
});
