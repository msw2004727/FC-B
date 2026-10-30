import { describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

vi.mock('@/data/auth', () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { createGuestViewer, createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';

import { isViewerPermissionsLoaded } from './viewer-ready';

function loadedViewer(uid: string): ViewerView {
  return {
    ...createMinimalViewer(uid),
    // 完整載入後 viewer.ts 每次都建新的 permissionSources 物件，即使內容和最小 viewer 一樣空。
    permissionSources: { rolePermissions: null, userGrants: [], customRoles: [] },
  };
}

describe('isViewerPermissionsLoaded（F3：完整 viewer 未到位前不能判成沒權限）', () => {
  it('最小 viewer（有 uid、權限一律 false）→ 尚未載入', () => {
    expect(isViewerPermissionsLoaded(createMinimalViewer('u1'))).toBe(false);
  });

  it('訪客（沒有 uid）→ 尚未載入', () => {
    expect(isViewerPermissionsLoaded(createGuestViewer())).toBe(false);
    expect(isViewerPermissionsLoaded({ uid: null, permissionSources: undefined })).toBe(false);
  });

  it('完整 viewer（permissionSources 是新物件）→ 已載入，即使內容和最小 viewer 一樣空', () => {
    expect(isViewerPermissionsLoaded(loadedViewer('u1'))).toBe(true);
  });

  it('測試替身省略 permissionSources（viewer.ts 註明為選填）→ 視為已載入', () => {
    expect(isViewerPermissionsLoaded({ uid: 'u1', permissionSources: undefined })).toBe(true);
  });

  it('最小 viewer 換了 uid 仍是最小 viewer', () => {
    expect(isViewerPermissionsLoaded(createMinimalViewer('another'))).toBe(false);
  });
});
