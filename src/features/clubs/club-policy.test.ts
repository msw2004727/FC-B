/**
 * `club-policy` 純函式測試。
 *
 * 覆蓋政策常數與每個判斷分支：
 *   - CLUB_DETAIL_REQUIRES_LOGIN / JOIN_REQUEST_COOLDOWN_MS
 *   - canViewClubDetail（預設設定 / 明確要求登入 / 開放訪客）
 *   - uid（有效字串 / null / undefined / 空字串 / 純空白）
 *   - 身分只看 uid，不看 displayName（R-ID-002）
 */

import { describe, expect, it } from 'vitest';

import {
  CLUB_DETAIL_REQUIRES_LOGIN,
  JOIN_REQUEST_COOLDOWN_MS,
  canViewClubDetail,
  resolveClubDetailAccess,
} from './club-policy';
import type { ClubDetailAccess, ClubViewer } from './club-policy';

describe('俱樂部政策常數', () => {
  it('俱樂部詳情預設要求登入', () => {
    expect(CLUB_DETAIL_REQUIRES_LOGIN).toBe(true);
  });

  it('加入申請冷卻時間為 24 小時', () => {
    expect(JOIN_REQUEST_COOLDOWN_MS).toBe(86_400_000);
  });
});

describe('canViewClubDetail', () => {
  it('預設設定允許有有效 uid 的登入者', () => {
    expect(canViewClubDetail({ uid: 'user-1' })).toBe(true);
    expect(canViewClubDetail({ uid: '  user-1  ' })).toBe(true);
  });

  it('預設設定拒絕 uid 為 null 的訪客', () => {
    expect(canViewClubDetail({ uid: null })).toBe(false);
  });

  it('預設設定拒絕 null 或 undefined viewer', () => {
    expect(canViewClubDetail(null)).toBe(false);
    expect(canViewClubDetail(undefined)).toBe(false);
  });

  it('預設設定拒絕空字串或純空白 uid', () => {
    expect(canViewClubDetail({ uid: '' })).toBe(false);
    expect(canViewClubDetail({ uid: '   ' })).toBe(false);
    expect(canViewClubDetail({ uid: '\t\n' })).toBe(false);
  });

  it('執行期收到 undefined uid 時仍視為訪客', () => {
    const viewer = { uid: undefined } as unknown as ClubViewer;

    expect(canViewClubDetail(viewer)).toBe(false);
  });

  it('開放訪客時允許任何人開啟詳情', () => {
    expect(canViewClubDetail({ uid: null }, false)).toBe(true);
    expect(canViewClubDetail(null, false)).toBe(true);
    expect(canViewClubDetail(undefined, false)).toBe(true);
    expect(canViewClubDetail({ uid: '' }, false)).toBe(true);
    expect(canViewClubDetail({ uid: '   ' }, false)).toBe(true);
    expect(canViewClubDetail({ uid: 'user-1' }, false)).toBe(true);
  });

  it('明確要求登入時與預設設定一致，允許登入者並拒絕訪客', () => {
    const cases: readonly {
      viewer: ClubViewer | null | undefined;
      expected: boolean;
    }[] = [
      { viewer: { uid: 'user-1' }, expected: true },
      { viewer: { uid: '  user-1  ' }, expected: true },
      { viewer: { uid: null }, expected: false },
      { viewer: null, expected: false },
      { viewer: undefined, expected: false },
      { viewer: { uid: '' }, expected: false },
      { viewer: { uid: '   ' }, expected: false },
    ];

    for (const { viewer, expected } of cases) {
      expect(canViewClubDetail(viewer, true)).toBe(expected);
      expect(canViewClubDetail(viewer)).toBe(expected);
    }
  });

  it('身分只看 uid，有 displayName 但 uid 為 null 仍拒絕', () => {
    const viewer = {
      uid: null,
      displayName: '王小明',
    } as unknown as ClubViewer;

    expect(canViewClubDetail(viewer)).toBe(false);
    expect(canViewClubDetail(viewer, true)).toBe(false);
  });
});

describe('resolveClubDetailAccess', () => {
  const validViewers: readonly ClubViewer[] = [
    { uid: 'u1' },
    { uid: '  u1  ' },
  ];
  const viewersWithoutUid: readonly (ClubViewer | null | undefined)[] = [
    { uid: null },
    null,
    undefined,
    { uid: '' },
    { uid: '   ' },
    { uid: '\t\n' },
    { uid: undefined } as unknown as ClubViewer,
  ];
  const authCases: readonly {
    authUid: string | null | undefined;
    expectedWithoutUid: ClubDetailAccess;
  }[] = [
    { authUid: undefined, expectedWithoutUid: 'pending' },
    { authUid: null, expectedWithoutUid: 'login-required' },
    { authUid: 'u1', expectedWithoutUid: 'pending' },
  ];

  it('有效 uid 在任何登入狀態與政策設定下皆允許存取', () => {
    for (const viewer of validViewers) {
      for (const { authUid } of authCases) {
        expect(resolveClubDetailAccess(viewer, authUid)).toBe('allowed');
        expect(resolveClubDetailAccess(viewer, authUid, true)).toBe('allowed');
        expect(resolveClubDetailAccess(viewer, authUid, false)).toBe('allowed');
      }
    }
  });

  it('開放訪客時所有 viewer 與登入狀態組合皆允許存取', () => {
    for (const viewer of viewersWithoutUid) {
      for (const { authUid } of authCases) {
        expect(resolveClubDetailAccess(viewer, authUid, false)).toBe('allowed');
      }
    }
  });

  it('要求登入且 viewer 無有效 uid 時，只有確定是訪客才要求登入，其餘等待 uid', () => {
    for (const viewer of viewersWithoutUid) {
      for (const { authUid, expectedWithoutUid } of authCases) {
        expect(resolveClubDetailAccess(viewer, authUid, true)).toBe(expectedWithoutUid);
        expect(resolveClubDetailAccess(viewer, authUid)).toBe(expectedWithoutUid);
      }
    }
  });

  it('預設參數與明確要求登入在所有 viewer 與登入狀態組合下結果一致', () => {
    for (const viewer of [...validViewers, ...viewersWithoutUid]) {
      for (const { authUid } of authCases) {
        expect(resolveClubDetailAccess(viewer, authUid)).toBe(
          resolveClubDetailAccess(viewer, authUid, true),
        );
      }
    }
  });

  it('登入已確定但 viewer uid 延後出現時，先等待再允許載入', () => {
    expect(resolveClubDetailAccess({ uid: null }, 'u1')).toBe('pending');
    expect(resolveClubDetailAccess({ uid: 'u1' }, 'u1')).toBe('allowed');
  });
});
