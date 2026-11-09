import { describe, expect, it } from 'vitest';
import * as guard from './event-create-guard';
import * as eventCreate from './event-create';
import * as formModel from './event-form-model';
import * as roleLabel from './role-label';

// 首頁瘦身把開團權限判斷與角色名稱搬到小模組；原模組照舊轉出，兩邊必須是同一份實作。
describe('搬出的開團權限判斷與角色名稱', () => {
  it('event-create 轉出的 canCreateEvent、EventCreateError 與 event-create-guard 是同一份', () => {
    expect(eventCreate.canCreateEvent).toBe(guard.canCreateEvent);
    expect(eventCreate.EventCreateError).toBe(guard.EventCreateError);
  });

  it('event-form-model 轉出的 roleLabelOf 與 role-label 是同一份', () => {
    expect(formModel.roleLabelOf).toBe(roleLabel.roleLabelOf);
  });

  it('送出時的檢查仍丟 EventCreateError（從 event-create 取得的類別可 instanceof 判斷）', () => {
    const ctx = {
      uid: 'u1',
      role: 'user',
      capabilities: [],
      rolePermissions: null,
      userGrants: null,
      now: new Date(0),
      generateId: (prefix: string) => `${prefix}_x`,
    };
    expect(guard.canCreateEvent(ctx)).toBe(false);
    let thrown: unknown = null;
    try {
      guard.assertCreateAllowed(ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(eventCreate.EventCreateError);
    expect((thrown as { code?: string }).code).toBe('BASIC_CREATE_REQUIRED');
    expect(guard.canCreateEvent({ ...ctx, capabilities: ['user.activity.basic_create'] })).toBe(true);
  });
});
