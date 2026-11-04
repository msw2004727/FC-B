import { describe, expect, it } from 'vitest';
import { canDeleteActivity, type OperateContext, type OperateEvent } from './operate-permissions';

// T-076b：刪除鈕對齊 Callable deleteEvent／Rules events delete。
// 修正前（照 A）會失敗的案例：只有 event.edit_all、文件缺失套預設權限、私密活動 delegate。

function ctx(over: Partial<OperateContext> = {}): OperateContext {
  return {
    uid: 'u-me',
    role: 'user',
    rolePermissions: null,
    userGrants: null,
    capabilities: [],
    customRoles: [],
    ...over,
  };
}

function grant(perms: string[], enabled: unknown = true): OperateContext['userGrants'] {
  return { uid: 'u-me', enabled, permissions: perms };
}

const own: OperateEvent = { creatorUid: 'u-me', delegateUids: [] };
const others: OperateEvent = { creatorUid: 'u-other', delegateUids: [] };

describe('canDeleteActivity 權限矩陣（對齊伺服器）', () => {
  it('admin、super_admin：任何活動都可刪（含權限文件全關）', () => {
    expect(canDeleteActivity(ctx({ role: 'admin', rolePermissions: [] }), others)).toBe(true);
    expect(canDeleteActivity(ctx({ role: 'super_admin', rolePermissions: [] }), others)).toBe(true);
  });

  it('角色有 event.delete：別人的活動也可刪', () => {
    expect(canDeleteActivity(ctx({ role: 'coach', rolePermissions: ['event.delete'] }), others)).toBe(true);
  });

  it('個別授權 event.delete：可刪；授權停用則否', () => {
    expect(canDeleteActivity(ctx({ userGrants: grant(['event.delete']) }), others)).toBe(true);
    expect(canDeleteActivity(ctx({ userGrants: grant(['event.delete'], false) }), others)).toBe(false);
  });

  it('擁有者＋event.delete_self 可刪；非擁有者有 delete_self 不可刪', () => {
    const c = ctx({ role: 'coach', rolePermissions: ['event.delete_self'] });
    expect(canDeleteActivity(c, own)).toBe(true);
    expect(canDeleteActivity(c, { ownerUid: 'u-me' })).toBe(true);
    expect(canDeleteActivity(c, { captainUid: 'u-me' })).toBe(true);
    expect(canDeleteActivity(c, others)).toBe(false);
  });

  it('擁有者沒有 delete_self：不可刪', () => {
    expect(canDeleteActivity(ctx({ role: 'coach', rolePermissions: ['activity.manage.entry'] }), own)).toBe(false);
  });

  it('只有 event.edit_all：不可刪（A 會顯示，伺服器會拒）', () => {
    expect(canDeleteActivity(ctx({ role: 'coach', rolePermissions: ['event.edit_all'] }), others)).toBe(false);
    expect(canDeleteActivity(ctx({ userGrants: grant(['event.edit_all']) }), own)).toBe(false);
  });

  it('角色權限文件不存在：不套預設權限（Rules 不認預設）', () => {
    expect(canDeleteActivity(ctx({ role: 'coach', rolePermissions: null }), own)).toBe(false);
  });

  it('user 角色的 rolePermissions 不算（Rules hasPerm 排除 user）', () => {
    expect(canDeleteActivity(ctx({ role: 'user', rolePermissions: ['event.delete'] }), others)).toBe(false);
  });

  it('delegate 本身不授予刪除', () => {
    const c = ctx({ role: 'coach', rolePermissions: ['event.delete_self'] });
    expect(canDeleteActivity(c, { creatorUid: 'u-other', delegateUids: ['u-me'] })).toBe(false);
  });

  it('私密活動：有 event.delete 的非擁有者、delegate 不可刪；擁有者與 admin 可刪', () => {
    const priv = { creatorUid: 'u-other', delegateUids: ['u-me'], privateEvent: true };
    expect(canDeleteActivity(ctx({ role: 'coach', rolePermissions: ['event.delete'] }), priv)).toBe(false);
    expect(canDeleteActivity(ctx({ role: 'admin', rolePermissions: [] }), priv)).toBe(true);
    expect(canDeleteActivity(
      ctx({ role: 'coach', rolePermissions: ['event.delete_self'] }),
      { creatorUid: 'u-me', privateEvent: true },
    )).toBe(true);
  });

  it('未就緒、訪客、沒有活動：不可刪', () => {
    expect(canDeleteActivity(ctx({ role: null }), own)).toBe(false);
    expect(canDeleteActivity(ctx({ uid: null, role: 'admin' }), own)).toBe(false);
    expect(canDeleteActivity(ctx({ role: 'admin' }), null)).toBe(false);
    expect(canDeleteActivity(ctx({ uid: 'unknown', role: 'admin' }), { creatorUid: 'unknown' })).toBe(false);
  });
});
