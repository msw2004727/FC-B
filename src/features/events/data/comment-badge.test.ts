import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetCommentBadgeForTest,
  canManageEventComments,
  getCommentBadgeCacheKey,
  requestCommentCount,
  sumCommentSnapshot,
} from './comment-badge';

afterEach(() => {
  _resetCommentBadgeForTest();
});

describe('canManageEventComments (A M-076)', () => {
  it('returns false when viewerUid is empty', () => {
    expect(canManageEventComments({}, null, 4)).toBe(false);
    expect(canManageEventComments({}, '', 4)).toBe(false);
  });

  it('returns true when roleLevel >= 4 (admin)', () => {
    expect(canManageEventComments({}, 'u1', 4)).toBe(true);
    expect(canManageEventComments({}, 'u1', 10)).toBe(true);
  });

  it('matches creatorUid', () => {
    expect(canManageEventComments({ creatorUid: 'u1' }, 'u1', 0)).toBe(true);
  });

  it('matches ownerUid', () => {
    expect(canManageEventComments({ ownerUid: 'u1' }, 'u1', 0)).toBe(true);
  });

  it('matches delegateUids', () => {
    expect(canManageEventComments({ delegateUids: ['other', 'u1'] }, 'u1', 0)).toBe(true);
  });

  it('matches delegates[].uid', () => {
    expect(canManageEventComments({ delegates: [{ uid: 'u1' }] }, 'u1', 0)).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(canManageEventComments({ creatorUid: 'other' }, 'u1', 0)).toBe(false);
  });

  it('does not check captainUid (per A event-comments.js)', () => {
    expect(canManageEventComments({ captainUid: 'u1' }, 'u1', 0)).toBe(false);
  });
});

describe('sumCommentSnapshot (A M-076)', () => {
  it('counts each doc as 1 + replyCount', () => {
    const docs = [
      { id: 'a', data: { replyCount: 2 } },
      { id: 'b', data: { replyCount: 0 } },
    ];
    expect(sumCommentSnapshot(docs)).toBe(4); // (1+2) + (1+0)
  });

  it('skips deleted docs', () => {
    const docs = [
      { id: 'a', data: { deleted: true, replyCount: 5 } },
      { id: 'b', data: { replyCount: 1 } },
    ];
    expect(sumCommentSnapshot(docs)).toBe(2);
  });

  it('deduplicates by id', () => {
    const docs = [
      { id: 'a', data: { replyCount: 1 } },
      { id: 'a', data: { replyCount: 2 } },
    ];
    expect(sumCommentSnapshot(docs)).toBe(2);
  });

  it('handles missing data', () => {
    expect(sumCommentSnapshot([{ id: 'a', data: undefined }])).toBe(1);
  });

  it('floors non-integer replyCount', () => {
    expect(sumCommentSnapshot([{ id: 'a', data: { replyCount: 2.9 } }])).toBe(3);
  });
});

describe('getCommentBadgeCacheKey', () => {
  it('builds key with eventId|uid|scope', () => {
    expect(getCommentBadgeCacheKey('e1', 'u1', 'manage')).toBe('e1|u1|manage');
    expect(getCommentBadgeCacheKey('e1', 'u1', 'member')).toBe('e1|u1|member');
  });
});

describe('requestCommentCount', () => {
  it('exposes cancel and does not throw when firebase is unavailable in test env', async () => {
    const req = requestCommentCount({
      cacheKey: 'e1|u1|member',
      eventId: 'e1',
      eventDocId: 'doc1',
      event: { id: 'e1', type: 'friendly' },
      viewerUid: 'u1',
      viewerRoleLevel: 0,
    });
    expect(typeof req.cancel).toBe('function');
    req.cancel();
    await req.promise.catch(() => undefined);
  });
});
