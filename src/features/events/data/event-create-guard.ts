/**
 * 開團權限判斷（從 event-create.ts 原樣搬出，首頁瘦身）。
 * 首頁「我要開團」入口只需要 canCreateEvent；放在獨立檔案，首屏才不必載入整個開團資料層
 * （Callable、封面上傳、表單模型）。event-create.ts 仍轉出 canCreateEvent 與 EventCreateError，送出時沿用同一套規則。
 * 本檔不得 import event-create.ts 的值（只可 import type），否則首屏又會帶回整個資料層。
 */

import {
  createPermissionChecker,
  type CustomRole,
} from '@/features/profile/data/permissions';
import { hasActivityManageEntry, type OperateContext } from './operate-permissions';
import type { CreateEventContext } from './event-create';

/** 可辨識錯誤（供呼叫端 switch code 顯示／降級）。 */
export class EventCreateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EventCreateError';
  }
}

export function toOperateContext(ctx: CreateEventContext): OperateContext {
  return {
    uid: ctx.uid,
    role: ctx.role,
    rolePermissions: ctx.rolePermissions,
    userGrants: ctx.userGrants,
    capabilities: ctx.capabilities,
    customRoles: (ctx.customRoles as readonly CustomRole[]) || [],
  };
}

function hasCapability(ctx: CreateEventContext, code: string): boolean {
  return ctx.capabilities.includes(code);
}

/** UI 用：是否顯示「我要開團」入口（與送出時的 assertCreateAllowed 同一套規則）。 */
export function canCreateEvent(ctx: CreateEventContext): boolean {
  try {
    assertCreateAllowed(ctx);
    return true;
  } catch {
    return false;
  }
}

export function assertCreateAllowed(ctx: CreateEventContext): void {
  const checker = createPermissionChecker({
    role: ctx.role,
    rolePermissions: ctx.rolePermissions ? { [ctx.role]: ctx.rolePermissions } : {},
    userGrants:
      ctx.userGrants && ctx.userGrants.enabled !== false &&
      String(ctx.userGrants.uid || '').trim() === ctx.uid
        ? (ctx.userGrants.permissions ?? [])
        : [],
    customRoles: (ctx.customRoles as readonly CustomRole[]) || [],
  });
  if (ctx.role === 'user') {
    const hasBasicCreate = hasCapability(ctx, 'user.activity.basic_create');
    const hasCreateGrant = checker('event.create');
    if (!hasBasicCreate && !hasCreateGrant) {
      throw new EventCreateError(
        'BASIC_CREATE_REQUIRED',
        'User lacks user.activity.basic_create capability or event.create grant.',
      );
    }
    return;
  }
  // coach+ / manage entry / event.create grant
  const hasManageEntry = hasActivityManageEntry(toOperateContext(ctx));
  if (!hasManageEntry && !checker('event.create')) {
    throw new EventCreateError(
      'CREATE_NOT_ALLOWED',
      'User lacks activity manage entry or event.create permission.',
    );
  }
}
