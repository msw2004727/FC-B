import { describe, expect, it } from 'vitest';
import { createGuestViewer, createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { canCreateEvent } from './event-create';
import { createEventContextFromViewer, operateContextFromViewer } from './event-create-context';
import { canEditOwnActivityBasic } from './operate-permissions';

function viewer(overrides: Partial<ViewerView>): ViewerView {
  return { ...createMinimalViewer('U_user'), ...overrides };
}

describe('createEventContextFromViewer', () => {
  it('訪客沒有建立 context', () => {
    expect(createEventContextFromViewer(createGuestViewer())).toBeNull();
  });

  it('一般 user 需要 basic_create 才能建立', () => {
    const none = createEventContextFromViewer(viewer({}))!;
    expect(canCreateEvent(none)).toBe(false);
    const withCap = createEventContextFromViewer(viewer({ capabilities: ['user.activity.basic_create'] }))!;
    expect(canCreateEvent(withCap)).toBe(true);
    expect(withCap.generateId('ce_')).toMatch(/^ce_/);
  });

  it('coach 以上靠活動管理入口即可建立（角色權限文件全關也一樣，A 的 coach+ fallback）', () => {
    const coach = createEventContextFromViewer(viewer({
      role: 'coach',
      permissionSources: { rolePermissions: [], userGrants: [], customRoles: [] },
    }))!;
    expect(canCreateEvent(coach)).toBe(true);
  });

  it('個別授權 event.create 也能建立', () => {
    const granted = createEventContextFromViewer(viewer({
      permissionSources: { rolePermissions: null, userGrants: ['event.create'], customRoles: [] },
    }))!;
    expect(canCreateEvent(granted)).toBe(true);
  });
});

describe('operateContextFromViewer', () => {
  it('訪客 role 為 null，所有操作拒絕；owner 有 own_edit_basic 可編輯自己的活動', () => {
    const guest = operateContextFromViewer(createGuestViewer());
    expect(guest.role).toBeNull();
    expect(canEditOwnActivityBasic(guest, { creatorUid: 'U_user' })).toBe(false);
    const owner = operateContextFromViewer(viewer({ capabilities: ['user.activity.own_edit_basic'] }));
    expect(canEditOwnActivityBasic(owner, { creatorUid: 'U_user' })).toBe(true);
    expect(canEditOwnActivityBasic(owner, { creatorUid: 'U_other' })).toBe(false);
  });
});

