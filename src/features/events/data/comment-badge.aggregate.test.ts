/**
 * 健檢 B2-04：活動卡留言數改 count() 聚合（每張卡 2 次讀取），不再把留言整份讀回來數。
 * 以假的 firebase/firestore 記錄查詢形狀；拿掉修正（改回 getDocs）時「不讀文件」的斷言會紅。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Node = { kind: string; args: unknown[] };
const calls = vi.hoisted(() => ({
  counts: [] as unknown[][],
  docs: [] as unknown[][],
  countResults: [] as Array<number | Error>,
  docsResult: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
}));

vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: { fake: true } }) }));
vi.mock('@/core/error-report', () => ({ reportClientError: vi.fn() }));
vi.mock('firebase/firestore', () => {
  const node = (kind: string) => (...args: unknown[]): Node => ({ kind, args });
  return {
    collection: (_db: unknown, ...path: string[]) => ({ kind: 'collection', args: path }),
    query: (ref: unknown, ...constraints: unknown[]) => ({ kind: 'query', args: [ref, ...constraints] }),
    where: node('where'),
    or: node('or'),
    and: node('and'),
    limit: node('limit'),
    getCountFromServer: async (q: Node) => {
      calls.counts.push(q.args.slice(1));
      const next = calls.countResults.shift();
      if (next instanceof Error) throw next;
      return { data: () => ({ count: next ?? 0 }) };
    },
    getDocs: async (q: Node) => {
      calls.docs.push(q.args.slice(1));
      return { docs: calls.docsResult };
    },
  };
});

import { _resetCommentBadgeForTest, fetchCommentCount } from './comment-badge';
import { reportClientError } from '@/core/error-report';

const member = {
  cacheKey: 'e1|u1|member', eventId: 'e1', eventDocId: 'doc1',
  event: { id: 'e1', type: 'friendly', creatorUid: 'owner' }, viewerUid: 'u1', viewerRoleLevel: 0,
};
const owner = { ...member, cacheKey: 'e1|owner|manage', viewerUid: 'owner' };
const where = (field: string, value: unknown) => ({ kind: 'where', args: [field, '==', value] });
const visible = { kind: 'or', args: [where('visibility', 'public'), where('authorUid', 'u1')] };
const firestoreError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  // 超量回報每台裝置每天一次（limit-report）：每案清掉，避免前一案的紀錄把後一案的回報吞掉而假綠（Opus P3-1）。
  localStorage.clear();
  calls.counts = [];
  calls.docs = [];
  calls.countResults = [];
  calls.docsResult = [];
});
afterEach(() => { _resetCommentBadgeForTest(); });

describe('fetchCommentCount（count() 聚合）', () => {
  it('一般人：or(公開, 自己寫的) 的筆數 − 其中已刪除的筆數；不讀任何留言文件', async () => {
    calls.countResults = [9, 2];
    await expect(fetchCommentCount(member)).resolves.toBe(7);
    expect(calls.counts).toEqual([
      [visible],
      [{ kind: 'and', args: [visible, where('deleted', true)] }],
    ]);
    expect(calls.docs).toEqual([]);
  });

  it('主辦／管理者：全部筆數 − 已刪除筆數', async () => {
    calls.countResults = [80 + 45, 5];
    await expect(fetchCommentCount(owner)).resolves.toBe(120);
    expect(calls.counts).toEqual([[], [where('deleted', true)]]);
    expect(calls.docs).toEqual([]);
  });

  it('聚合被拒（例如要求索引）：改回整份讀取，之後的卡片也直接走原本做法', async () => {
    calls.countResults = [firestoreError('failed-precondition'), 0];
    calls.docsResult = [
      { id: 'a', data: () => ({ visibility: 'public' }) },
      { id: 'b', data: () => ({ visibility: 'public', deleted: true }) },
    ];
    await expect(fetchCommentCount(member)).resolves.toBe(1);
    expect(calls.docs.length).toBe(2);
    calls.counts = [];
    await expect(fetchCommentCount(member)).resolves.toBe(1);
    expect(calls.counts).toEqual([]);
  });

  it('備援數法：查詢多抓一筆（一般人 61／31、管理者 81），超過上限只算上限內並送固定內容的錯誤回報', async () => {
    vi.mocked(reportClientError).mockClear();
    calls.countResults = [firestoreError('failed-precondition'), 0];
    calls.docsResult = Array.from({ length: 61 }, (_, i) => ({ id: `p${i}`, data: () => ({ visibility: 'public' }) }));
    await expect(fetchCommentCount(member)).resolves.toBe(60);
    const limits = calls.docs.map((args) => (args.find((c) => (c as Node).kind === 'limit') as Node | undefined)?.args[0]);
    expect(limits).toEqual([61, 31]);
    expect(vi.mocked(reportClientError).mock.calls.every(([c]) => c === 'comment-badge-limit')).toBe(true);
    expect(vi.mocked(reportClientError).mock.calls.map(([, e]) => (e as Error).message))
      .toEqual(['comments exceed 60', 'comments exceed 30']);

    vi.mocked(reportClientError).mockClear();
    calls.docs = [];
    calls.docsResult = Array.from({ length: 81 }, (_, i) => ({ id: `m${i}`, data: () => ({ visibility: 'public' }) }));
    await expect(fetchCommentCount(owner)).resolves.toBe(80);
    expect(calls.docs.map((args) => (args.find((c) => (c as Node).kind === 'limit') as Node | undefined)?.args[0])).toEqual([81]);
    expect(vi.mocked(reportClientError).mock.calls.map(([, e]) => (e as Error).message)).toEqual(['comments exceed 80']);
  });

  it('網路類錯誤不切換做法，照常往外丟（徽章靜默不顯示）', async () => {
    calls.countResults = [firestoreError('unavailable'), 0];
    await expect(fetchCommentCount(member)).rejects.toThrow('unavailable');
    expect(calls.docs).toEqual([]);
  });

  it('未登入、外部活動不查', async () => {
    await expect(fetchCommentCount({ ...member, viewerUid: '' })).resolves.toBe(0);
    await expect(fetchCommentCount({ ...member, event: { id: 'e1', type: 'external' } })).resolves.toBe(0);
    expect(calls.counts).toEqual([]);
  });
});
