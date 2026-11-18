import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PERM_USERS_CHANGE_ROLE,
  PERM_USERS_EDIT_PROFILE,
  PERM_USERS_RESTRICT,
  type AdminUser,
  type AdminUserActor,
} from './admin-users-model';

const mockGetDocs = vi.fn();
const mockGetCount = vi.fn();
const mockStartAfter = vi.fn((value: unknown) => ({ startAfter: value }));
const mockLimit = vi.fn((value: unknown) => ({ limit: value }));
const mockOrderBy = vi.fn((value: unknown) => ({ orderBy: value }));
const mockQuery = vi.fn((...args: unknown[]) => ({ query: args }));
const mockCollection = vi.fn((_db: unknown, name: string) => ({ collection: name }));

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, name: string) => mockCollection(db, name),
  documentId: () => '__name__',
  getCountFromServer: (...args: unknown[]) => mockGetCount(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  limit: (value: unknown) => mockLimit(value),
  orderBy: (value: unknown) => mockOrderBy(value),
  query: (...args: unknown[]) => mockQuery(...args),
  startAfter: (value: unknown) => mockStartAfter(value),
}));

const mockGetIdToken = vi.fn();
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(() => Promise.resolve({
    db: { name: 'mock-db' },
    auth: { currentUser: { getIdToken: (...args: unknown[]) => mockGetIdToken(...args) } },
  })),
}));

const mockCallFn = vi.fn();
vi.mock('@/data/callables', () => ({
  callFn: (...args: unknown[]) => mockCallFn(...args),
}));

const mockDeliver = vi.fn();
vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: (...args: unknown[]) => mockDeliver(...args),
}));

const mockLoadTemplate = vi.fn();
vi.mock('@/data/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/notify')>();
  return { ...actual, loadNotifTemplate: (key: string) => mockLoadTemplate(key) };
});

const mockWriteOpLog = vi.fn();
vi.mock('@/data/op-log', () => ({
  writeOpLog: (...args: unknown[]) => mockWriteOpLog(...args),
}));

const mockEmit = vi.fn();
vi.mock('@/core/events', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

import {
  ADMIN_USERS_CHUNK_SIZE,
  ADMIN_USERS_FULL_LOAD_MAX,
  ADMIN_USERS_OPLOG_ENABLED,
  AdminUserGuardError,
  buildManageUserRequest,
  classifyAdminUserError,
  fetchCustomRoles,
  loadAdminUsers,
  loadMoreAdminUsers,
  manageAdminUser,
  recordUserOpLog,
  sendRoleUpgradeInbox,
  writeUserAudit,
} from './admin-users';

function target(patch: Partial<AdminUser> = {}): AdminUser {
  return {
    _docId: 'doc-1', uid: 'uid-1', lineUserId: '', name: '小明', role: 'user', email: '', gender: '', region: '',
    sports: '', phone: '', birthday: '', exp: 0, pictureUrl: '', teamName: '', isRestricted: false, stealth: false,
    joinedAtMs: null, lastLoginMs: null, lastLoginIp: '', lastLoginRegion: '', lastLoginIsp: '', ...patch,
  };
}

function actor(role: string, perms: readonly string[] | 'all', uid = 'actor-1'): AdminUserActor {
  return { uid, role, hasPermission: (code) => perms === 'all' || perms.includes(code) };
}

const ADMIN_ALL = actor('admin', 'all');

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks 不清「永久」實作與未用完的 Once；逐一 reset，避免前一案的設定漏進下一案。
  for (const fn of [mockGetDocs, mockGetCount, mockDeliver, mockLoadTemplate, mockWriteOpLog, mockCallFn, mockGetIdToken]) fn.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-1' });
  mockGetIdToken.mockResolvedValue('token');
});

describe('buildManageUserRequest（請求形狀契約）', () => {
  it('只改個人資料：請求只含 targetUid 與 profileUpdates', () => {
    expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target(), profileUpdates: { phone: '0988', email: null } }))
      .toEqual({ targetUid: 'doc-1', profileUpdates: { phone: '0988', email: null } });
  });

  it('限制：只送 restrictionUpdate.isRestricted，不送 restrictedAt／ByUid／ByName（伺服器重算）', () => {
    const req = buildManageUserRequest({ actor: ADMIN_ALL, target: target(), restriction: true });
    expect(req).toEqual({ targetUid: 'doc-1', restrictionUpdate: { isRestricted: true } });
    expect(JSON.stringify(req)).not.toMatch(/restrictedAt|restrictedBy/);
    expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target({ isRestricted: true }), restriction: false }))
      .toEqual({ targetUid: 'doc-1', restrictionUpdate: { isRestricted: false } });
  });

  it('改角色：roleChange 的 manualRole 與 role 同值，不送 isAdmin／claims', () => {
    const req = buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: 'coach' });
    expect(req).toEqual({ targetUid: 'doc-1', roleChange: { role: 'coach', manualRole: 'coach' } });
    expect(JSON.stringify(req)).not.toMatch(/isAdmin|claims/);
  });

  it('資料與角色同時送出（A saveUserEdit 一次呼叫）', () => {
    expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target(), profileUpdates: { region: '台北市' }, role: 'captain' }))
      .toEqual({ targetUid: 'doc-1', profileUpdates: { region: '台北市' }, roleChange: { role: 'captain', manualRole: 'captain' } });
  });

  it('profileUpdates 夾帶白名單外欄位（role、exp、isRestricted…）→ 丟錯，不送出', () => {
    for (const extra of ['role', 'exp', 'isRestricted', 'claims', 'manualRole', 'uid']) {
      expect(() => buildManageUserRequest({
        actor: ADMIN_ALL,
        target: target(),
        profileUpdates: { phone: '1', [extra]: 'x' } as never,
      })).toThrow(/未允許欄位/);
    }
  });

  // 測試同步更新（R-QA-005）：原案寫「優先用 uid」，與 A 不一致。依據 A js/api-service.js:1639 updateAdminUser 送
  // `user._docId || user.uid || user.lineUserId`（文件 ID）：伺服器先直接讀 users/{傳入值}，送 uid 在舊資料
  // （隨機 ID 文件與 users/{uid} 並存）會命中另一份文件，前端對目標角色的守衛就對錯文件。
  it('C1：targetUid 送文件 ID（同 A）；同時有 _docId 與 uid 時送 _docId，沒有 _docId 才退回 uid；兩者都沒有 → invalid-argument', () => {
    expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target({ _docId: 'doc-9', uid: 'uid-9' }), restriction: true }).targetUid).toBe('doc-9');
    expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target({ uid: '', _docId: 'doc-9' }), restriction: true }).targetUid).toBe('doc-9');
    expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target({ uid: 'uid-9', _docId: '' }), restriction: true }).targetUid).toBe('uid-9');
    expect(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target({ uid: '', _docId: '' }), restriction: true }))
      .toThrowError(expect.objectContaining({ code: 'invalid-argument' }));
  });

  it('C1：舊資料（隨機 ID 文件 + 與 uid 同名的另一份正式文件並存）時，請求指向列表上的那份文件而不是 uid', () => {
    const legacy = target({ _docId: 'legacy-random-id', uid: 'U-shared', role: 'user' });
    const req = buildManageUserRequest({ actor: ADMIN_ALL, target: legacy, restriction: true });
    expect(req.targetUid).toBe('legacy-random-id');
    expect(req.targetUid).not.toBe('U-shared');
  });

  it('什麼都不改 → invalid-argument', () => {
    expect(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target() }))
      .toThrowError(expect.objectContaining({ code: 'invalid-argument' }));
    expect(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target(), profileUpdates: {} }))
      .toThrowError(expect.objectContaining({ code: 'invalid-argument' }));
  });

  describe('寫入函式內部驗呼叫者權限（permission-denied，不依賴元件層守衛）', () => {
    const denied = (fn: () => unknown): void => {
      expect(fn).toThrowError(expect.objectContaining({ name: 'AdminUserGuardError', code: 'permission-denied' }));
    };

    it('缺 edit_profile 不能改個人資料', () => {
      denied(() => buildManageUserRequest({ actor: actor('admin', [PERM_USERS_CHANGE_ROLE]), target: target(), profileUpdates: { phone: '1' } }));
    });

    it('缺 restrict 不能限制；目標不是 user、是 super_admin、是自己都不行', () => {
      denied(() => buildManageUserRequest({ actor: actor('admin', [PERM_USERS_EDIT_PROFILE]), target: target(), restriction: true }));
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target({ role: 'coach' }), restriction: true }));
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target({ role: 'super_admin' }), restriction: true }));
      denied(() => buildManageUserRequest({ actor: actor('admin', 'all', 'uid-1'), target: target({ uid: 'uid-1' }), restriction: true }));
    });

    it('缺 change_role 不能改角色；教練／領隊即使有權限碼也不行', () => {
      denied(() => buildManageUserRequest({ actor: actor('admin', [PERM_USERS_RESTRICT]), target: target(), role: 'coach' }));
      denied(() => buildManageUserRequest({ actor: actor('coach', 'all'), target: target(), role: 'captain' }));
      denied(() => buildManageUserRequest({ actor: actor('captain', 'all'), target: target(), role: 'coach' }));
    });

    it('admin 不能指派 admin／super_admin，也不能改同級（admin）或 super_admin 的角色', () => {
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: 'admin' }));
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: 'super_admin' }));
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target({ role: 'admin' }), role: 'user' }));
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target({ role: 'super_admin' }), role: 'user' }));
    });

    it('super_admin 可指派 admin、可改 admin 的角色', () => {
      const s = actor('super_admin', 'all');
      expect(buildManageUserRequest({ actor: s, target: target(), role: 'admin' }).roleChange).toEqual({ role: 'admin', manualRole: 'admin' });
      expect(buildManageUserRequest({ actor: s, target: target({ role: 'admin' }), role: 'user' }).roleChange).toEqual({ role: 'user', manualRole: 'user' });
    });

    it('空白角色不送出', () => {
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: '  ' }));
    });

    // F5：授權突變（拿掉 canEditProfileOf 內的 canManageTarget）要能被抓到。
    it('F5：admin 對 super_admin 目標送 profileUpdates → permission-denied；super_admin 可以', () => {
      const superTarget = target({ role: 'super_admin' });
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: superTarget, profileUpdates: { phone: '1' } }));
      denied(() => buildManageUserRequest({ actor: actor('admin', [PERM_USERS_EDIT_PROFILE]), target: superTarget, profileUpdates: { phone: '1' } }));
      expect(buildManageUserRequest({ actor: actor('super_admin', 'all'), target: superTarget, profileUpdates: { phone: '1' } }))
        .toEqual({ targetUid: 'doc-1', profileUpdates: { phone: '1' } });
    });

    it('F5：admin 對 super_admin 目標做 manageAdminUser 時不會呼叫 Callable', async () => {
      await expect(manageAdminUser({ actor: ADMIN_ALL, target: target({ role: 'super_admin' }), profileUpdates: { phone: '1' } }))
        .rejects.toMatchObject({ code: 'permission-denied' });
      expect(mockCallFn).not.toHaveBeenCalled();
    });

    // F4：縱深防禦——伺服器把自訂角色視為層級 0，前端依插入層級多擋一道。
    it('F4：帶入自訂角色清單時，admin 不能指派排在 admin／super_admin 之後的自訂角色，排在之前可以', () => {
      const customRoles = [
        { key: 'vip', label: 'VIP', afterRole: 'captain' },
        { key: 'top', label: '頂級管理', afterRole: 'admin' },
        { key: 'beyond', label: '總管之後', afterRole: 'super_admin' },
      ];
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: 'top', customRoles }));
      denied(() => buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: 'beyond', customRoles }));
      expect(buildManageUserRequest({ actor: ADMIN_ALL, target: target(), role: 'vip', customRoles }).roleChange)
        .toEqual({ role: 'vip', manualRole: 'vip' });
      const s = actor('super_admin', 'all');
      expect(buildManageUserRequest({ actor: s, target: target(), role: 'top', customRoles }).roleChange)
        .toEqual({ role: 'top', manualRole: 'top' });
    });
  });
});

describe('manageAdminUser（走 Callable adminManageUser）', () => {
  it('以 callFn("adminManageUser", request) 送出一次，並回傳伺服器回應', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-1', role: 'coach' });
    const res = await manageAdminUser({ actor: ADMIN_ALL, target: target(), role: 'coach' });
    expect(mockCallFn).toHaveBeenCalledTimes(1);
    expect(mockCallFn).toHaveBeenCalledWith('adminManageUser', {
      targetUid: 'doc-1',
      roleChange: { role: 'coach', manualRole: 'coach' },
    });
    expect(res).toMatchObject({ success: true, role: 'coach' });
    expect(mockGetIdToken).not.toHaveBeenCalled();
  });

  it('守衛不過時不呼叫 Callable', async () => {
    await expect(manageAdminUser({ actor: actor('user', []), target: target(), role: 'coach' }))
      .rejects.toBeInstanceOf(AdminUserGuardError);
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('伺服器回 forceRefreshToken（自改角色）→ 強制換新 ID token 並通知 viewer 重讀', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'actor-1', role: 'coach', forceRefreshToken: true });
    await manageAdminUser({ actor: actor('super_admin', 'all', 'actor-1'), target: target({ uid: 'actor-1' }), role: 'coach' });
    expect(mockGetIdToken).toHaveBeenCalledWith(true);
    expect(mockEmit).toHaveBeenCalledWith('viewer:refresh', {});
  });

  it('換 token 失敗不影響已成功的主操作（只 warn），仍通知 viewer 重讀', async () => {
    mockCallFn.mockResolvedValue({ success: true, forceRefreshToken: true });
    mockGetIdToken.mockRejectedValue(new Error('network'));
    await expect(manageAdminUser({ actor: actor('super_admin', 'all'), target: target(), role: 'coach' })).resolves.toMatchObject({ success: true });
    expect(console.warn).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith('viewer:refresh', {});
  });

  it('Callable 失敗（permission-denied 等）原樣往外拋，由畫面轉成人話訊息', async () => {
    mockCallFn.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(manageAdminUser({ actor: ADMIN_ALL, target: target(), restriction: true })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('classifyAdminUserError', () => {
  it('依 code 分類，接受 functions/ 前綴', () => {
    expect(classifyAdminUserError({ code: 'permission-denied' })).toBe('permission');
    expect(classifyAdminUserError({ code: 'functions/permission-denied' })).toBe('permission');
    expect(classifyAdminUserError({ code: 'functions/not-found' })).toBe('not_found');
    expect(classifyAdminUserError({ code: 'failed-precondition' })).toBe('precondition');
    expect(classifyAdminUserError({ code: 'unauthenticated' })).toBe('unauthenticated');
    expect(classifyAdminUserError({ code: 'internal' })).toBe('other');
    expect(classifyAdminUserError(new Error('x'))).toBe('other');
    expect(classifyAdminUserError(null)).toBe('other');
    expect(classifyAdminUserError(new AdminUserGuardError('permission-denied', 'x'))).toBe('permission');
  });
});

describe('writeUserAudit（best-effort）', () => {
  it('payload 對照 A：action、targetType user、targetId、targetLabel、result success、source web、meta 狀態', async () => {
    await writeUserAudit({ action: 'role_change', target: { uid: 'uid-1', name: '小明' }, statusFrom: 'user', statusTo: 'coach' });
    expect(mockCallFn).toHaveBeenCalledWith('writeAuditLog', {
      action: 'role_change',
      targetType: 'user',
      targetId: 'uid-1',
      targetLabel: '小明',
      result: 'success',
      source: 'web',
      meta: { statusFrom: 'user', statusTo: 'coach' },
    });
  });

  it('失敗只 warn，不往外拋', async () => {
    mockCallFn.mockRejectedValue(new Error('boom'));
    await expect(writeUserAudit({ action: 'admin_user_edit', target: { uid: 'u', name: 'n' }, statusFrom: '', statusTo: '' })).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('recordUserOpLog（operationLogs；旗標預設開，顧問 2026-10-27 裁定）', () => {
  const entry = {
    type: 'role', typeName: '角色變更', content: '小明 手動晉升為「教練」（原：一般用戶）',
    actorUid: 'actor-1', operator: '管理員',
  };

  it('旗標常數預設為 true，沒指定 enabled 時會寫操作日誌', async () => {
    expect(ADMIN_USERS_OPLOG_ENABLED).toBe(true);
    await recordUserOpLog(entry);
    expect(mockWriteOpLog).toHaveBeenCalledTimes(1);
  });

  it('寫入欄位：type／typeName／content／operator，且 actorUid 是操作者（R-ID-003），不是被改的用戶', async () => {
    await recordUserOpLog({ ...entry, enabled: true });
    expect(mockWriteOpLog).toHaveBeenCalledWith({
      type: 'role', typeName: '角色變更', content: entry.content, actorUid: 'actor-1', operator: '管理員',
    });
    // 沒有 uid 欄位（operationLogs 只有 actorUid）。
    expect(Object.keys(mockWriteOpLog.mock.calls[0]?.[0] as object).sort()).toEqual(['actorUid', 'content', 'operator', 'type', 'typeName']);
  });

  it('旗標明確關閉：不寫（稽核 writeAuditLog 不受影響）', async () => {
    await recordUserOpLog({ ...entry, enabled: false });
    expect(mockWriteOpLog).not.toHaveBeenCalled();
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('寫入失敗：只 warn，不往外拋', async () => {
    mockWriteOpLog.mockRejectedValue(new Error('x'));
    await expect(recordUserOpLog({ ...entry, enabled: true })).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('sendRoleUpgradeInbox（只寫站內信，不發 LINE）', () => {
  const notice = { targetUid: 'uid-1', userName: '小明', roleName: '教練', senderUid: 'actor-1' };

  it('使用內建 role_upgrade 範本，category private／私訊、寄件人 系統', async () => {
    mockLoadTemplate.mockResolvedValue(null);
    mockDeliver.mockResolvedValue({ id: 'msg_1' });
    await expect(sendRoleUpgradeInbox(notice)).resolves.toBe(true);
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    const arg = mockDeliver.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      title: '身份變更通知', category: 'private', categoryName: '私訊', targetUid: 'uid-1', senderName: '系統', senderUid: 'actor-1',
    });
    expect(arg['body']).toContain('恭喜 小明！您的身份已變更為「教練」');
  });

  it('Firestore 有自訂範本（title、body 都有）時優先採用；缺 body 退回內建', async () => {
    mockLoadTemplate.mockResolvedValue({ title: '自訂標題 {roleName}', body: '嗨 {userName} 現在是 {roleName}' });
    mockDeliver.mockResolvedValue({});
    await sendRoleUpgradeInbox(notice);
    expect(mockDeliver.mock.calls[0]?.[0]).toMatchObject({ title: '自訂標題 教練', body: '嗨 小明 現在是 教練' });

    mockLoadTemplate.mockResolvedValue({ title: '只有標題' });
    await sendRoleUpgradeInbox(notice);
    expect(mockDeliver.mock.calls[1]?.[0]).toMatchObject({ title: '身份變更通知' });
  });

  it('不呼叫 enqueuePrivilegedLineNotification，也沒有任何 Callable 呼叫', async () => {
    mockLoadTemplate.mockResolvedValue(null);
    mockDeliver.mockResolvedValue({});
    await sendRoleUpgradeInbox(notice);
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('沒有收件人 UID 不寄；5 秒內重複（deliver 回 null）回 false', async () => {
    await expect(sendRoleUpgradeInbox({ ...notice, targetUid: '  ' })).resolves.toBe(false);
    expect(mockDeliver).not.toHaveBeenCalled();
    mockLoadTemplate.mockResolvedValue(null);
    mockDeliver.mockResolvedValue(null);
    await expect(sendRoleUpgradeInbox(notice)).resolves.toBe(false);
  });

  it('投遞失敗只 warn、回 false，不往外拋', async () => {
    mockLoadTemplate.mockResolvedValue(null);
    mockDeliver.mockRejectedValue(new Error('inbox down'));
    await expect(sendRoleUpgradeInbox(notice)).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('讀取名單（一次性、聚合 count、降級分批）', () => {
  function docs(from: number, to: number): { id: string; data: () => Record<string, unknown> }[] {
    return Array.from({ length: to - from }, (_, i) => ({
      id: `u${String(from + i).padStart(5, '0')}`,
      data: () => ({ displayName: `用戶${from + i}`, role: 'user' }),
    }));
  }
  const countOf = (count: number) => ({ data: () => ({ count }) });

  it('常數：全量讀取上限 5000、每批 1000', () => {
    expect(ADMIN_USERS_FULL_LOAD_MAX).toBe(5000);
    expect(ADMIN_USERS_CHUNK_SIZE).toBe(1000);
  });

  it('人數 ≤ 5000：依文件 ID 分批讀完（startAfter 接上一批最後一筆），不標記 partial', async () => {
    mockGetCount.mockResolvedValue(countOf(1005));
    mockGetDocs.mockResolvedValueOnce({ docs: docs(0, 1000) }).mockResolvedValueOnce({ docs: docs(1000, 1005) });
    const result = await loadAdminUsers();
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect(mockStartAfter).toHaveBeenCalledTimes(1);
    expect(mockStartAfter).toHaveBeenCalledWith('u00999');
    expect(mockOrderBy).toHaveBeenCalledWith('__name__');
    expect(result).toMatchObject({ total: 1005, partial: false, done: true });
    expect(result.users).toHaveLength(1005);
    expect(result.users[0]).toMatchObject({ _docId: 'u00000', name: '用戶0', uid: 'u00000' });
  });

  it('剛好一批就讀完（第一批不滿 1000 筆）→ 只讀一次', async () => {
    mockGetCount.mockResolvedValue(countOf(3));
    mockGetDocs.mockResolvedValueOnce({ docs: docs(0, 3) });
    const result = await loadAdminUsers();
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ partial: false, done: true });
  });

  it('人數 > 5000：只讀第一批並標記 partial，按「載入更多用戶」才讀下一批並合併不重複', async () => {
    mockGetCount.mockResolvedValue(countOf(6000));
    mockGetDocs.mockResolvedValueOnce({ docs: docs(0, 1000) });
    const first = await loadAdminUsers();
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ total: 6000, partial: true, done: false, lastId: 'u00999' });
    expect(first.users).toHaveLength(1000);

    mockGetDocs.mockResolvedValueOnce({ docs: [...docs(999, 1000), ...docs(1000, 1010)] });
    const next = await loadMoreAdminUsers(first);
    expect(mockStartAfter).toHaveBeenLastCalledWith('u00999');
    expect(next.users).toHaveLength(1010);
    expect(next).toMatchObject({ partial: false, done: true });
  });

  it('邊界：剛好 5000 人仍全部讀完（5 批滿 + 1 批空）；5001 人就降級只讀第一批', async () => {
    const chunkByCall = (call: number) => ({ docs: call < 5 ? docs(call * 1000, call * 1000 + 1000) : [] });
    let call = 0;
    mockGetCount.mockResolvedValue(countOf(5000));
    mockGetDocs.mockImplementation(() => Promise.resolve(chunkByCall(call++)));
    const all = await loadAdminUsers();
    expect(all.users).toHaveLength(5000);
    expect(all).toMatchObject({ partial: false, done: true });
    expect(mockGetDocs).toHaveBeenCalledTimes(6);

    mockGetDocs.mockReset();
    call = 0;
    mockGetDocs.mockImplementation(() => Promise.resolve(chunkByCall(call++)));
    mockGetCount.mockResolvedValue(countOf(5001));
    const degraded = await loadAdminUsers();
    expect(degraded.users).toHaveLength(1000);
    expect(degraded).toMatchObject({ partial: true, done: false });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('防呆：讀取期間人數暴增、一直有滿批時，最多多讀 2 批就停並標記 partial', async () => {
    let call = 0;
    mockGetCount.mockResolvedValue(countOf(5000));
    mockGetDocs.mockImplementation(() => {
      const from = call * 1000;
      call += 1;
      return Promise.resolve({ docs: docs(from, from + 1000) });
    });
    const result = await loadAdminUsers();
    expect(mockGetDocs).toHaveBeenCalledTimes(7);
    expect(result).toMatchObject({ partial: true, done: false });
    expect(result.users).toHaveLength(7000);
  });

  it('已讀完時 loadMore 不再發查詢', async () => {
    const done = { users: [], total: 0, partial: false, lastId: null, done: true };
    await loadMoreAdminUsers(done);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  // 測試同步更新（R-QA-005）：原案「count 失敗只讀第一批」會讓搜尋靜默找不到第 1,001 位之後的人（旗標關閉時連說明列都沒有）。
  it('C2：count 查詢失敗（人數未知）比照全讀：1,500 人分兩批讀完，partial 為 false、total 為 null', async () => {
    mockGetCount.mockRejectedValue(new Error('offline'));
    mockGetDocs.mockResolvedValueOnce({ docs: docs(0, 1000) }).mockResolvedValueOnce({ docs: docs(1000, 1500) });
    const result = await loadAdminUsers();
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect(mockStartAfter).toHaveBeenCalledWith('u00999');
    expect(result.users).toHaveLength(1500);
    expect(result).toMatchObject({ total: null, partial: false, done: true });
  });

  it('C2：count 查詢失敗且人數超過分批上限 → 讀滿 7 批（7,000 筆）後停止並標記 partial', async () => {
    mockGetCount.mockRejectedValue(new Error('offline'));
    let call = 0;
    mockGetDocs.mockImplementation(() => {
      const from = call * 1000;
      call += 1;
      return Promise.resolve({ docs: docs(from, from + 1000) });
    });
    const result = await loadAdminUsers();
    expect(mockGetDocs).toHaveBeenCalledTimes(7);
    expect(result.users).toHaveLength(7000);
    expect(result).toMatchObject({ total: null, partial: true, done: false });
  });

  it('讀取失敗往外拋（畫面顯示重試）', async () => {
    mockGetCount.mockResolvedValue(countOf(3));
    mockGetDocs.mockRejectedValue(new Error('permission'));
    await expect(loadAdminUsers()).rejects.toThrow('permission');
  });

  it('自訂角色：key 取 key → roleKey → 文件 ID；失敗回空陣列', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { id: 'a', data: () => ({ key: 'vip', label: 'VIP', color: '#fff', afterRole: 'captain' }) },
        { id: 'b', data: () => ({ roleKey: 'vvip' }) },
        { id: 'c', data: () => ({}) },
        { id: 'd', data: () => ({ key: '  ' }) },
      ],
    });
    expect(await fetchCustomRoles()).toEqual([
      { key: 'vip', label: 'VIP', color: '#fff', afterRole: 'captain' },
      { key: 'vvip', label: undefined, color: undefined, afterRole: undefined },
      { key: 'c', label: undefined, color: undefined, afterRole: undefined },
    ]);
    mockGetDocs.mockRejectedValueOnce(new Error('x'));
    expect(await fetchCustomRoles()).toEqual([]);
  });
});
