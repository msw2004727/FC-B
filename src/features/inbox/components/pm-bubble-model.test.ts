import { describe, expect, it } from 'vitest';
import type { PmThread } from '../data/pm-repo';
import {
  findNewUnreadThread,
  pmConversationKey,
  resolvePeerUid,
} from './pm-bubble-model';

describe('pmConversationKey — 照 A `_pmConversationKey`', () => {
  it('依序優先 conversationId、id、_docId', () => {
    expect(pmConversationKey({ id: 'a', conversationId: 'c', _docId: 'd' })).toBe('c');
    expect(pmConversationKey({ id: 'b', _docId: 'd' })).toBe('b');
    expect(pmConversationKey({ _docId: 'd' } as unknown as Parameters<typeof pmConversationKey>[0])).toBe('d');
  });

  it('字串直接 trim，null／undefined 回空字串', () => {
    expect(pmConversationKey('  abc  ')).toBe('abc');
    expect(pmConversationKey(null)).toBe('');
    expect(pmConversationKey(undefined)).toBe('');
  });
});

describe('resolvePeerUid — 照 A `_resolvePmThreadPeerUid`', () => {
  it('優先回傳非 myUid 的 peerUid', () => {
    const thread: PmThread = { id: 'c', peerUid: 'peer1' };
    expect(resolvePeerUid(thread, 'me')).toBe('peer1');
  });

  it('peerUid 等於 myUid 時改找 participants', () => {
    const thread: PmThread = { id: 'c', peerUid: 'me', participants: ['me', 'peer1'] };
    expect(resolvePeerUid(thread, 'me')).toBe('peer1');
  });

  it('peerUid 不存在時從 participants 挑對方', () => {
    const thread: PmThread = { id: 'c', participants: ['peer1', 'me'] };
    expect(resolvePeerUid(thread, 'me')).toBe('peer1');
  });

  it('myUid 空字串回空字串', () => {
    expect(resolvePeerUid({ id: 'c', peerUid: 'peer1' }, '')).toBe('');
  });

  it('完全無對方資訊回空字串', () => {
    expect(resolvePeerUid({ id: 'c' }, 'me')).toBe('');
  });
});

describe('findNewUnreadThread — 照 A `_findPmUnreadIncrease`', () => {
  it('首次快照（prev = null）不提醒', () => {
    expect(
      findNewUnreadThread(null, [{ id: 'a', unreadCount: 5 }]),
    ).toBeNull();
  });

  it('unread 增加才算新訊息，回傳該 thread', () => {
    const prev: PmThread[] = [{ id: 'a', unreadCount: 0 }];
    const next: PmThread[] = [{ id: 'a', unreadCount: 1 }];
    expect(findNewUnreadThread(prev, next)?.id).toBe('a');
  });

  it('unread 相同不回傳', () => {
    const prev: PmThread[] = [{ id: 'a', unreadCount: 2 }];
    const next: PmThread[] = [{ id: 'a', unreadCount: 2 }];
    expect(findNewUnreadThread(prev, next)).toBeNull();
  });

  it('unread 減少不回傳', () => {
    const prev: PmThread[] = [{ id: 'a', unreadCount: 2 }];
    const next: PmThread[] = [{ id: 'a', unreadCount: 0 }];
    expect(findNewUnreadThread(prev, next)).toBeNull();
  });

  it('全新 thread unread > 0 回傳', () => {
    const prev: PmThread[] = [];
    const next: PmThread[] = [{ id: 'new', peerUid: 'p', unreadCount: 3 }];
    expect(findNewUnreadThread(prev, next)?.id).toBe('new');
  });

  it('全新 thread unread = 0 不回傳', () => {
    const prev: PmThread[] = [];
    const next: PmThread[] = [{ id: 'new', peerUid: 'p', unreadCount: 0 }];
    expect(findNewUnreadThread(prev, next)).toBeNull();
  });

  it('conversationId 優先對齊（不同 doc id 但同一對話）', () => {
    const prev: PmThread[] = [{ id: 'x', conversationId: 'conv', unreadCount: 0 }];
    const next: PmThread[] = [{ id: 'y', conversationId: 'conv', unreadCount: 2 }];
    expect(findNewUnreadThread(prev, next)?.conversationId).toBe('conv');
  });
});
