import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPublicSnapshot,
  getEventCommentAuthor,
  getMainIdentity,
  normalizePublicIdentitySnapshot,
  resolveEventCommentDisplay,
} from './identity-snapshot';
import {
  _resetIdentitySettingsForTest,
  setIdentitySettingsLocal,
} from '@/data/identity-settings';
import { normalizeIdentitySettings } from '@/data/identity-resolver';

afterEach(() => {
  _resetIdentitySettingsForTest();
});

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

  // 測試同步更新：照 1B-4，有權限＋第二身份啟用 → snapshot 為第二身份、authorName 仍主身份。
  it('有權限＋第二身份啟用 → snapshot 為第二身份、authorName 仍主身份', () => {
    setIdentitySettingsLocal(normalizeIdentitySettings({
      profileActiveIdentityId: 'secondary',
      identities: { secondary: { enabled: true, displayName: '官方帳號', avatarUrl: 'official.jpg' } },
    }));
    const author = getEventCommentAuthor({
      uid: 'u',
      displayName: '小明',
      pictureUrl: 'line.jpg',
      hasPermission: (code: string) => code === 'profile.secondary_identity',
    });
    expect(author.authorName).toBe('小明');
    expect(author.authorPhoto).toBe('line.jpg');
    expect(author.identitySnapshot).toEqual({
      identityId: 'secondary',
      displayName: '官方帳號',
      avatarUrl: 'official.jpg',
    });
  });

  // 測試同步更新：照 1B-4，無權限 → main。
  it('無權限 → 即使第二身份啟用也走主身份', () => {
    setIdentitySettingsLocal(normalizeIdentitySettings({
      profileActiveIdentityId: 'secondary',
      identities: { secondary: { enabled: true, displayName: '官方帳號' } },
    }));
    const author = getEventCommentAuthor({
      uid: 'u',
      displayName: '小明',
      hasPermission: () => false,
    });
    expect(author.identitySnapshot.identityId).toBe('main');
    expect(author.authorName).toBe('小明');
  });
});
