import { describe, expect, it } from 'vitest';

import type { ProfilePrivateData } from '@/data/profile-private';
import {
  applyPrivateProfiles,
  patchPrivateProfileMap,
  type AdminProfileUpdates,
  type AdminUser,
} from './admin-users-model';

function user(patch: Partial<AdminUser> = {}): AdminUser {
  return {
    _docId: 'doc-1', uid: 'uid-1', lineUserId: '', name: '小明', role: 'user',
    email: 'old@example.com', gender: '', region: '', sports: '', phone: '0911',
    birthday: '', exp: 0, pictureUrl: '', teamName: '', isRestricted: false, stealth: false,
    joinedAtMs: null, lastLoginMs: null, lastLoginIp: '', lastLoginRegion: '', lastLoginIsp: '',
    ...patch,
  };
}

describe('applyPrivateProfiles', () => {
  it('email／phone 逐欄覆蓋；私密有自有屬性的鍵才覆蓋', () => {
    const users = [user()];
    const map = new Map<string, ProfilePrivateData>([['doc-1', { email: 'new@example.com', phone: '0222' }]]);
    const out = applyPrivateProfiles(users, map);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(users[0]);
    expect(out[0]).toMatchObject({ email: 'new@example.com', phone: '0222' });
  });

  it('私密值 null 轉成空字串（與 mapUserDoc 的 text() 一致）', () => {
    const map = new Map<string, ProfilePrivateData>([['doc-1', { email: null, phone: null }]]);
    expect(applyPrivateProfiles([user()], map)[0]).toMatchObject({ email: '', phone: '' });
  });

  it('私密只給 email 時 phone 保留根值；反之亦然', () => {
    const onlyEmail = new Map<string, ProfilePrivateData>([['doc-1', { email: 'x@y' }]]);
    expect(applyPrivateProfiles([user()], onlyEmail)[0]).toMatchObject({ email: 'x@y', phone: '0911' });

    const onlyPhone = new Map<string, ProfilePrivateData>([['doc-1', { phone: '0999' }]]);
    expect(applyPrivateProfiles([user()], onlyPhone)[0]).toMatchObject({ email: 'old@example.com', phone: '0999' });
  });

  it('沒有對應項時回同一參考（不重新建立物件）', () => {
    const users = [user(), user({ _docId: 'doc-2', email: 'b@b', phone: '2' })];
    const map = new Map<string, ProfilePrivateData>([['doc-1', { phone: '9' }]]);
    const out = applyPrivateProfiles(users, map);
    expect(out[0]).not.toBe(users[0]);
    expect(out[1]).toBe(users[1]);
  });

  it('空 Map 時所有 user 都回同一參考', () => {
    const users = [user(), user({ _docId: 'doc-2' })];
    const out = applyPrivateProfiles(users, new Map());
    expect(out[0]).toBe(users[0]);
    expect(out[1]).toBe(users[1]);
  });
});

describe('patchPrivateProfileMap', () => {
  it('只改有給的鍵、不改其他 docId；回新 Map；不改原 Map', () => {
    const map = new Map<string, ProfilePrivateData>([
      ['doc-1', { email: 'old', phone: '1' }],
      ['doc-2', { email: 'other', phone: '2' }],
    ]);
    const updates: AdminProfileUpdates = { phone: '999' };
    const next = patchPrivateProfileMap(map, 'doc-1', updates);
    expect(next).not.toBe(map);
    expect(next.get('doc-1')).toEqual({ email: 'old', phone: '999' });
    expect(next.get('doc-2')).toBe(map.get('doc-2'));
    // 原 Map 內容不動
    expect(map.get('doc-1')).toEqual({ email: 'old', phone: '1' });
  });

  it('null 值保留 null（applyPrivateProfiles 套用時才轉空字串）', () => {
    const map = new Map<string, ProfilePrivateData>([['doc-1', { email: 'old', phone: '1' }]]);
    const next = patchPrivateProfileMap(map, 'doc-1', { email: null });
    expect(next.get('doc-1')).toEqual({ email: null, phone: '1' });
    // 套用時才轉空字串
    expect(applyPrivateProfiles([user()], next)[0]?.email).toBe('');
  });

  it('docId 不存在時建立新 entry；非 email／phone 的 updates 不影響內容', () => {
    const map = new Map<string, ProfilePrivateData>([['doc-1', { email: 'a' }]]);
    const next = patchPrivateProfileMap(map, 'doc-9', { region: '台北' } as never);
    expect(next.get('doc-1')).toEqual({ email: 'a' });
    expect(next.has('doc-9')).toBe(false);

    const created = patchPrivateProfileMap(map, 'doc-new', { email: 'new@b', region: '台北' } as never);
    expect(created.get('doc-new')).toEqual({ email: 'new@b' });
    // 原 doc-1 不受影響
    expect(created.get('doc-1')).toEqual({ email: 'a' });
  });

  it('profileUpdates 同時含 email／phone 時兩個都更新', () => {
    const map = new Map<string, ProfilePrivateData>([['doc-1', { email: 'old', phone: '1' }]]);
    const next = patchPrivateProfileMap(map, 'doc-1', { email: 'new', phone: '2' });
    expect(next.get('doc-1')).toEqual({ email: 'new', phone: '2' });
  });

  it('profileUpdates 只含其他欄位（例如 birthday）時回等價新 Map，不改任何 entry', () => {
    const map = new Map<string, ProfilePrivateData>([['doc-1', { email: 'a', phone: '1' }]]);
    const next = patchPrivateProfileMap(map, 'doc-1', { birthday: '2000/01/01' });
    expect(next).not.toBe(map);
    expect(next.get('doc-1')).toBe(map.get('doc-1'));
  });
});
