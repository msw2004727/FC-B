import { describe, expect, it } from 'vitest';
import {
  buildPublicSnapshot,
  getEventCommentAuthor,
  getMainIdentity,
  normalizePublicIdentitySnapshot,
  resolveEventCommentDisplay,
} from './identity-snapshot';

describe('M-093 作者身份', () => {
  it('只認 UID，主身份依 A 使用名稱及照片備援', () => {
    expect(getMainIdentity({ uid: ' u ', name: ' 小明 ', photoURL: ' p ' })).toMatchObject({
      uid: 'u', displayName: '小明', pictureUrl: 'p',
    });
    expect(getEventCommentAuthor({ displayName: '小明' }).uid).toBe('');
    expect(getMainIdentity({ uid: 'u' }).displayName).toBe('u');
    expect(getMainIdentity({}).displayName).toBe('用戶');
  });

  it('公開快照限制 80／1200，根作者欄位不擅自截斷', () => {
    const author = getEventCommentAuthor({
      uid: 'u', displayName: '名'.repeat(81), pictureUrl: 'x'.repeat(1201),
    });
    expect(author.authorName).toHaveLength(81);
    expect(author.authorPhoto).toHaveLength(1201);
    expect(buildPublicSnapshot({ displayName: '名'.repeat(81) }).displayName).toHaveLength(80);
    expect(author.identitySnapshot.avatarUrl).toHaveLength(1200);
    expect(author.identitySnapshot.identityId).toBe('main');
  });

  it('拒絕無效快照', () => {
    for (const raw of [null, [], {}, { identityId: 'other', displayName: '名' },
      { identityId: 'main', displayName: ' ' }]) {
      expect(normalizePublicIdentitySnapshot(raw)).toBeNull();
    }
  });

  it('第二身份顯示公開名稱，空頭像不得洩漏主身份頭像', () => {
    expect(resolveEventCommentDisplay({
      authorName: '真實姓名',
      authorPhoto: 'private-photo',
      identitySnapshot: { identityId: 'secondary', displayName: '官方', avatarUrl: '' },
    })).toMatchObject({
      authorName: '官方',
      authorPhoto: '',
      identitySnapshot: { identityId: 'secondary' },
    });
    expect(resolveEventCommentDisplay({ authorName: '舊作者', authorPhoto: 'p' }))
      .toMatchObject({ authorName: '舊作者', authorPhoto: 'p', identitySnapshot: null });
  });
});
