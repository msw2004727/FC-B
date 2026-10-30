import { describe, expect, it } from 'vitest';

import {
  ADMIN_USER_PAGE_SIZE,
  EMPTY_FILTER_INPUTS,
  PERM_USERS_CHANGE_ROLE,
  PERM_USERS_EDIT_PROFILE,
  PERM_USERS_RESTRICT,
  applyEditToUser,
  applyFilters,
  buildEditUpdates,
  buildProfileEditOpLog,
  buildRestrictionOpLog,
  buildRoleChangeOpLog,
  canAssignRole,
  canChangeRoleOf,
  canEditProfileOf,
  canManageTarget,
  canOpenEditor,
  canToggleRestrictionOf,
  coerceTimeMs,
  daysSince,
  formValuesFromUser,
  formatLastLogin,
  getAssignableRoleKeys,
  hasActiveFilters,
  mapUserDoc,
  matchesDayRange,
  normalizeBirthdayForInput,
  normalizeFilters,
  roleLabel,
  serverRoleLevel,
  showsEditButton,
  sliceVisible,
  sortUsersByName,
  tagRole,
  type AdminUser,
  type AdminUserActor,
  type AdminUserFilterInputs,
} from './admin-users-model';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 4, 0, 0);

function user(patch: Partial<AdminUser> = {}): AdminUser {
  return {
    _docId: 'u-target',
    uid: 'u-target',
    lineUserId: '',
    name: '小明',
    role: 'user',
    email: '',
    gender: '',
    region: '',
    sports: '',
    phone: '',
    birthday: '',
    exp: 0,
    pictureUrl: '',
    teamName: '',
    isRestricted: false,
    stealth: false,
    joinedAtMs: null,
    lastLoginMs: null,
    lastLoginIp: '',
    lastLoginRegion: '',
    lastLoginIsp: '',
    ...patch,
  };
}

function actor(role: string, perms: readonly string[] | 'all', uid = 'u-actor'): AdminUserActor {
  return { uid, role, hasPermission: (code) => perms === 'all' || perms.includes(code) };
}

function inputs(patch: Partial<AdminUserFilterInputs>): AdminUserFilterInputs {
  return { ...EMPTY_FILTER_INPUTS, ...patch };
}

const ALL_USER_PERMS = [PERM_USERS_EDIT_PROFILE, PERM_USERS_CHANGE_ROLE, PERM_USERS_RESTRICT] as const;

describe('mapUserDoc（A _mapUserDoc 投影）', () => {
  it('name = displayName || name || 未知；uid = uid || lineUserId || docId', () => {
    expect(mapUserDoc({ displayName: 'D', name: 'N', uid: 'U', lineUserId: 'L' }, 'doc').name).toBe('D');
    expect(mapUserDoc({ name: 'N' }, 'doc').name).toBe('N');
    expect(mapUserDoc({}, 'doc').name).toBe('未知');
    expect(mapUserDoc({ uid: 'U', lineUserId: 'L' }, 'doc').uid).toBe('U');
    expect(mapUserDoc({ lineUserId: 'L' }, 'doc').uid).toBe('L');
    expect(mapUserDoc({}, 'doc').uid).toBe('doc');
    expect(mapUserDoc(undefined, 'doc')._docId).toBe('doc');
  });

  it('role 缺值視為 user；sports 陣列轉成「, 」串接；exp 負數與非數字當 0', () => {
    expect(mapUserDoc({}, 'd').role).toBe('user');
    expect(mapUserDoc({ role: ' coach ' }, 'd').role).toBe('coach');
    expect(mapUserDoc({ sports: ['足球', '籃球'] }, 'd').sports).toBe('足球, 籃球');
    expect(mapUserDoc({ sports: '足球' }, 'd').sports).toBe('足球');
    expect(mapUserDoc({ exp: -5 }, 'd').exp).toBe(0);
    expect(mapUserDoc({ exp: 'x' }, 'd').exp).toBe(0);
  });

  it('加入時間取 createdAt → joinedAt → registeredAt 第一個有值的；登入取 lastLogin → lastActive', () => {
    const ts = (ms: number) => ({ toMillis: () => ms });
    expect(mapUserDoc({ createdAt: ts(1000), joinedAt: ts(2000) }, 'd').joinedAtMs).toBe(1000);
    expect(mapUserDoc({ joinedAt: ts(2000), registeredAt: ts(3000) }, 'd').joinedAtMs).toBe(2000);
    expect(mapUserDoc({ registeredAt: ts(3000) }, 'd').joinedAtMs).toBe(3000);
    expect(mapUserDoc({ lastLogin: ts(5000), lastActive: ts(6000) }, 'd').lastLoginMs).toBe(5000);
    expect(mapUserDoc({ lastActive: ts(6000) }, 'd').lastLoginMs).toBe(6000);
    expect(mapUserDoc({}, 'd').lastLoginMs).toBeNull();
  });

  it('isRestricted／stealth 只認 true', () => {
    expect(mapUserDoc({ isRestricted: true, stealth: true }, 'd')).toMatchObject({ isRestricted: true, stealth: true });
    expect(mapUserDoc({ isRestricted: 'true', stealth: 1 }, 'd')).toMatchObject({ isRestricted: false, stealth: false });
  });
});

describe('時間轉換（A _coerceAdminUserTimeMs；字串依台北時區）', () => {
  it('Timestamp 形物件、Date、數字（小於 1e12 視為秒）', () => {
    expect(coerceTimeMs({ seconds: 100 })).toBe(100_000);
    expect(coerceTimeMs({ toDate: () => new Date(5000) })).toBe(5000);
    expect(coerceTimeMs(new Date(7000))).toBe(7000);
    expect(coerceTimeMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(coerceTimeMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('無時區字串當台北牆鐘（2026/10/27 08:00 = 00:00Z）；帶時區 ISO 照原樣', () => {
    expect(coerceTimeMs('2026/10/27 08:00')).toBe(Date.UTC(2026, 9, 27, 0, 0, 0));
    expect(coerceTimeMs('2026-10-27T00:00:00Z')).toBe(Date.UTC(2026, 9, 27, 0, 0, 0));
  });

  it('空值、無法解析回 null', () => {
    expect(coerceTimeMs(null)).toBeNull();
    expect(coerceTimeMs('')).toBeNull();
    expect(coerceTimeMs('不是日期')).toBeNull();
    expect(coerceTimeMs(0)).toBeNull();
  });

  it('生日欄位正規化成 YYYY-MM-DD', () => {
    expect(normalizeBirthdayForInput('1990/05/01')).toBe('1990-05-01');
    expect(normalizeBirthdayForInput('1990-05-01')).toBe('1990-05-01');
    expect(normalizeBirthdayForInput('')).toBe('');
    expect(normalizeBirthdayForInput(null)).toBe('');
  });
});

describe('篩選輸入正規化（A _getAdminUserFilters）', () => {
  it('關鍵字、地區、Email 去空白並轉小寫；身份與性別只去空白', () => {
    const f = normalizeFilters(inputs({ keyword: '  AbC ', region: ' 台北 ', email: ' A@B.COM ', role: ' coach ', gender: ' 男 ' }));
    expect(f).toMatchObject({ keyword: 'abc', region: '台北', email: 'a@b.com', role: 'coach', gender: '男' });
  });

  it('天數：空字串、負數、非數字為 null；小數無條件捨去；0 有效', () => {
    const f = normalizeFilters(inputs({ joinedMin: '', joinedMax: '-1', loginMin: 'abc', loginMax: '3.9' }));
    expect(f.joinedMinDays).toBeNull();
    expect(f.joinedMaxDays).toBeNull();
    expect(f.loginMinDays).toBeNull();
    expect(f.loginMaxDays).toBe(3);
    expect(normalizeFilters(inputs({ joinedMin: '0' })).joinedMinDays).toBe(0);
  });

  it('hasActiveFilters：任一條件有值（含天數 0）才算啟用', () => {
    expect(hasActiveFilters(normalizeFilters(EMPTY_FILTER_INPUTS))).toBe(false);
    expect(hasActiveFilters(normalizeFilters(inputs({ keyword: 'a' })))).toBe(true);
    expect(hasActiveFilters(normalizeFilters(inputs({ loginMax: '0' })))).toBe(true);
    expect(hasActiveFilters(null)).toBe(false);
  });
});

describe('區間日（A _matchesAdminUserDayRange）', () => {
  it('daysSince：經過的整天數（不是日曆天），未來時間取 0，null 回 null', () => {
    expect(daysSince(NOW - 2 * DAY - 1, NOW)).toBe(2);
    expect(daysSince(NOW - DAY + 1, NOW)).toBe(0);
    expect(daysSince(NOW + 5 * DAY, NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('沒有設定區間一律符合（含沒有時間的人）', () => {
    expect(matchesDayRange(null, null, null, NOW)).toBe(true);
  });

  it('有設定區間時，沒有時間的人不符合', () => {
    expect(matchesDayRange(null, 0, null, NOW)).toBe(false);
    expect(matchesDayRange(null, null, 5, NOW)).toBe(false);
  });

  it('起迄皆含邊界', () => {
    const t = (days: number) => NOW - days * DAY;
    expect(matchesDayRange(t(3), 3, 5, NOW)).toBe(true);
    expect(matchesDayRange(t(5), 3, 5, NOW)).toBe(true);
    expect(matchesDayRange(t(2), 3, 5, NOW)).toBe(false);
    expect(matchesDayRange(t(6), 3, 5, NOW)).toBe(false);
  });

  it('起大於迄時互換（5~3 等同 3~5）', () => {
    const t = (days: number) => NOW - days * DAY;
    expect(matchesDayRange(t(4), 5, 3, NOW)).toBe(true);
    expect(matchesDayRange(t(2), 5, 3, NOW)).toBe(false);
    expect(matchesDayRange(t(6), 5, 3, NOW)).toBe(false);
  });

  it('只有起或只有迄', () => {
    const t = (days: number) => NOW - days * DAY;
    expect(matchesDayRange(t(10), 7, null, NOW)).toBe(true);
    expect(matchesDayRange(t(1), 7, null, NOW)).toBe(false);
    expect(matchesDayRange(t(1), null, 7, NOW)).toBe(true);
    expect(matchesDayRange(t(10), null, 7, NOW)).toBe(false);
  });
});

describe('applyFilters（A _applyAdminUserFilters）', () => {
  const list: AdminUser[] = [
    user({ _docId: 'a', uid: 'uid-a', name: 'Alice', role: 'coach', gender: '女', region: '台北市', email: 'Alice@Example.com', joinedAtMs: NOW - 10 * DAY, lastLoginMs: NOW - 1 * DAY }),
    user({ _docId: 'b', uid: 'uid-b', lineUserId: 'line-b', name: 'Bob', role: 'user', gender: '男', region: '高雄市', email: 'bob@test.org', joinedAtMs: NOW - 40 * DAY, lastLoginMs: NOW - 30 * DAY }),
    user({ _docId: 'c', uid: 'uid-c', name: '王小明', role: 'user', gender: '', region: '', email: '', joinedAtMs: null, lastLoginMs: null }),
  ];
  const run = (patch: Partial<AdminUserFilterInputs>) =>
    applyFilters(list, normalizeFilters(inputs(patch)), NOW).map((u) => u._docId);

  it('沒有條件時全部保留', () => {
    expect(run({})).toEqual(['a', 'b', 'c']);
  });

  it('關鍵字比對 name、uid、lineUserId、docId、email，不分大小寫', () => {
    expect(run({ keyword: 'ALICE' })).toEqual(['a']);
    expect(run({ keyword: 'uid-b' })).toEqual(['b']);
    expect(run({ keyword: 'line-b' })).toEqual(['b']);
    expect(run({ keyword: 'TEST.ORG' })).toEqual(['b']);
    expect(run({ keyword: '王小' })).toEqual(['c']);
    expect(run({ keyword: '不存在' })).toEqual([]);
  });

  it('身份、性別精確比對', () => {
    expect(run({ role: 'coach' })).toEqual(['a']);
    expect(run({ role: 'user' })).toEqual(['b', 'c']);
    expect(run({ gender: '男' })).toEqual(['b']);
  });

  it('地區、Email 為包含比對且不分大小寫', () => {
    expect(run({ region: '台北' })).toEqual(['a']);
    expect(run({ region: '市' })).toEqual(['a', 'b']);
    expect(run({ email: 'EXAMPLE' })).toEqual(['a']);
  });

  it('加入區間與最後登入區間；沒有時間的人在有設定時被排除', () => {
    expect(run({ joinedMin: '30' })).toEqual(['b']);
    expect(run({ joinedMax: '15' })).toEqual(['a']);
    expect(run({ loginMin: '0', loginMax: '2' })).toEqual(['a']);
    expect(run({ loginMin: '2', loginMax: '0' })).toEqual(['a']); // 起迄顛倒互換
  });

  it('多條件為 AND', () => {
    expect(run({ role: 'user', gender: '男', region: '高雄' })).toEqual(['b']);
    expect(run({ role: 'coach', gender: '男' })).toEqual([]);
  });
});

describe('排序與分頁（每頁 30、載入更多 +30）', () => {
  it('依名字 localeCompare 排序且不改原陣列', () => {
    const original = [user({ _docId: '1', name: 'b' }), user({ _docId: '2', name: 'a' }), user({ _docId: '3', name: '' })];
    const sorted = sortUsersByName(original);
    expect(sorted.map((u) => u._docId)).toEqual(['3', '2', '1']);
    expect(original.map((u) => u._docId)).toEqual(['1', '2', '3']);
  });

  it('sliceVisible：預設 30 筆，剛好 30 筆沒有更多，31 筆有更多', () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(ADMIN_USER_PAGE_SIZE).toBe(30);
    expect(sliceVisible(make(30), 30)).toMatchObject({ hasMore: false });
    expect(sliceVisible(make(31), 30)).toMatchObject({ hasMore: true });
    expect(sliceVisible(make(31), 30).visible).toHaveLength(30);
    expect(sliceVisible(make(100), 60).visible).toHaveLength(60);
    expect(sliceVisible(make(100), 0).visible).toHaveLength(30);
  });
});

describe('顯示 helper', () => {
  it('formatLastLogin 用台北牆鐘，附 IP 與地區／ISP', () => {
    const u = user({ lastLoginMs: Date.UTC(2026, 9, 27, 0, 5, 0), lastLoginIp: '1.2.3.4', lastLoginRegion: 'TW', lastLoginIsp: 'HiNet' });
    expect(formatLastLogin(u, '尚無紀錄')).toBe('2026/10/27 08:05 ・ 1.2.3.4 ・ TW / HiNet');
    expect(formatLastLogin(user(), '尚無紀錄')).toBe('尚無紀錄');
  });

  it('roleLabel：內建 → 自訂 → 原字串', () => {
    expect(roleLabel('coach', [])).toBe('教練');
    expect(roleLabel('x', [{ key: 'x', label: '特約教練' }])).toBe('特約教練');
    expect(roleLabel('zzz', [])).toBe('zzz');
  });

  it('tagRole：管理員隱身時膠囊顯示一般用戶，其他角色不受影響', () => {
    expect(tagRole(user({ role: 'admin', stealth: true }))).toBe('user');
    expect(tagRole(user({ role: 'super_admin', stealth: true }))).toBe('user');
    expect(tagRole(user({ role: 'admin', stealth: false }))).toBe('admin');
    expect(tagRole(user({ role: 'coach', stealth: true }))).toBe('coach');
  });
});

describe('權限矩陣：誰能做什麼（按鈕顯示與送出守衛共用這組 helper）', () => {
  const targetUser = user({ role: 'user' });
  const targetCoach = user({ _docId: 'c', uid: 'c', role: 'coach' });
  const targetAdmin = user({ _docId: 'ad', uid: 'ad', role: 'admin' });
  const targetSuper = user({ _docId: 'su', uid: 'su', role: 'super_admin' });

  it('一般用戶、教練、領隊沒有任何後台權限碼：全部 false', () => {
    for (const role of ['user', 'coach', 'captain']) {
      const a = actor(role, []);
      for (const target of [targetUser, targetCoach, targetAdmin, targetSuper]) {
        expect(canEditProfileOf(a, target)).toBe(false);
        expect(canChangeRoleOf(a, target)).toBe(false);
        expect(canToggleRestrictionOf(a, target)).toBe(false);
        expect(canOpenEditor(a, target)).toBe(false);
        expect(showsEditButton(a, target)).toBe(false);
      }
    }
  });

  it('即使拿到權限碼（個別授權），教練／領隊／場主與自訂角色也改不了角色（伺服器要求呼叫者至少 admin）', () => {
    for (const role of ['coach', 'captain', 'venue_owner', 'custom_x']) {
      const a = actor(role, ALL_USER_PERMS);
      expect(canChangeRoleOf(a, targetUser)).toBe(false);
      expect(canEditProfileOf(a, targetUser)).toBe(true);
    }
  });

  it('admin 三個子權限碼各自獨立：缺哪個就沒有哪個動作', () => {
    const only = (code: string) => actor('admin', [code]);
    expect(canEditProfileOf(only(PERM_USERS_EDIT_PROFILE), targetUser)).toBe(true);
    expect(canChangeRoleOf(only(PERM_USERS_EDIT_PROFILE), targetUser)).toBe(false);
    expect(canToggleRestrictionOf(only(PERM_USERS_EDIT_PROFILE), targetUser)).toBe(false);

    expect(canEditProfileOf(only(PERM_USERS_CHANGE_ROLE), targetUser)).toBe(false);
    expect(canChangeRoleOf(only(PERM_USERS_CHANGE_ROLE), targetUser)).toBe(true);

    expect(canToggleRestrictionOf(only(PERM_USERS_RESTRICT), targetUser)).toBe(true);
    expect(canOpenEditor(only(PERM_USERS_RESTRICT), targetUser)).toBe(false);
    expect(showsEditButton(only(PERM_USERS_RESTRICT), targetUser)).toBe(false);
  });

  it('admin 不得處理 super_admin；不得改同級（admin）或更高的角色，但可改較低角色', () => {
    const a = actor('admin', 'all');
    expect(canManageTarget(a, targetSuper)).toBe(false);
    expect(canOpenEditor(a, targetSuper)).toBe(false);
    expect(canChangeRoleOf(a, targetSuper)).toBe(false);
    expect(canChangeRoleOf(a, targetAdmin)).toBe(false);
    expect(canChangeRoleOf(a, targetCoach)).toBe(true);
    expect(canChangeRoleOf(a, targetUser)).toBe(true);
    // 改不了同級角色，但仍可編輯其個人資料。
    expect(canEditProfileOf(a, targetAdmin)).toBe(true);
    expect(canOpenEditor(a, targetAdmin)).toBe(true);
  });

  it('super_admin 可處理所有人，但列表「編輯」鈕不對 super_admin 目標顯示（照 A）', () => {
    const a = actor('super_admin', 'all');
    expect(canChangeRoleOf(a, targetAdmin)).toBe(true);
    expect(canChangeRoleOf(a, targetSuper)).toBe(true);
    expect(canOpenEditor(a, targetSuper)).toBe(true);
    expect(showsEditButton(a, targetSuper)).toBe(false);
    expect(showsEditButton(a, targetAdmin)).toBe(true);
  });

  it('限制帳號：目標必須是 role=user、非 super_admin、不是自己', () => {
    const a = actor('admin', 'all', 'me');
    expect(canToggleRestrictionOf(a, user({ role: 'user', uid: 'someone' }))).toBe(true);
    expect(canToggleRestrictionOf(a, user({ role: 'user', uid: 'me' }))).toBe(false);
    expect(canToggleRestrictionOf(a, targetCoach)).toBe(false);
    expect(canToggleRestrictionOf(a, targetAdmin)).toBe(false);
    expect(canToggleRestrictionOf(a, targetSuper)).toBe(false);
    const s = actor('super_admin', 'all', 'me');
    expect(canToggleRestrictionOf(s, targetSuper)).toBe(false);
    expect(canToggleRestrictionOf(s, user({ role: 'user', uid: 'x' }))).toBe(true);
  });

  it('可指派角色：admin 看不到 admin／super_admin；super_admin 看得到全部；自訂角色（伺服器視為 0）可指派', () => {
    const custom = [{ key: 'vip', label: 'VIP', afterRole: 'captain' }];
    expect(getAssignableRoleKeys('admin', [])).toEqual(['user', 'coach', 'captain', 'venue_owner']);
    expect(getAssignableRoleKeys('admin', custom)).toEqual(['user', 'coach', 'captain', 'vip', 'venue_owner']);
    expect(getAssignableRoleKeys('super_admin', custom)).toEqual(['user', 'coach', 'captain', 'vip', 'venue_owner', 'admin', 'super_admin']);
  });

  it('canAssignRole：非 super_admin 不得指派 admin 以上；空字串不行', () => {
    const a = actor('admin', 'all');
    expect(canAssignRole(a, 'coach')).toBe(true);
    expect(canAssignRole(a, 'admin')).toBe(false);
    expect(canAssignRole(a, 'super_admin')).toBe(false);
    expect(canAssignRole(a, '')).toBe(false);
    expect(canAssignRole(actor('super_admin', 'all'), 'super_admin')).toBe(true);
  });

  // F5：授權突變（拿掉 canEditProfileOf 內的 canManageTarget）要能被抓到。
  it('F5：admin（即使有 edit_profile）不能編輯 super_admin 目標的資料；super_admin 可以', () => {
    const a = actor('admin', 'all');
    expect(canEditProfileOf(a, targetSuper)).toBe(false);
    expect(canEditProfileOf(actor('admin', [PERM_USERS_EDIT_PROFILE]), targetSuper)).toBe(false);
    expect(canEditProfileOf(actor('coach', [PERM_USERS_EDIT_PROFILE]), targetSuper)).toBe(false);
    expect(canEditProfileOf(actor('super_admin', 'all'), targetSuper)).toBe(true);
    // 同一組判斷也決定彈窗能不能開、編輯鈕要不要顯示。
    expect(canOpenEditor(actor('admin', [PERM_USERS_EDIT_PROFILE]), targetSuper)).toBe(false);
    expect(showsEditButton(actor('admin', [PERM_USERS_EDIT_PROFILE]), targetSuper)).toBe(false);
  });

  it('F4：非 super_admin 不能指派排在 admin／super_admin 之後的自訂角色（依其插入層級）；排在 admin 之前的可以', () => {
    const custom = [
      { key: 'vip', label: 'VIP', afterRole: 'captain' },
      { key: 'top', label: '頂級管理', afterRole: 'admin' },
      { key: 'beyond', label: '總管之後', afterRole: 'super_admin' },
    ];
    const a = actor('admin', 'all');
    expect(canAssignRole(a, 'vip', custom)).toBe(true);
    expect(canAssignRole(a, 'top', custom)).toBe(false);
    expect(canAssignRole(a, 'beyond', custom)).toBe(false);
    expect(getAssignableRoleKeys('admin', custom)).toEqual(['user', 'coach', 'captain', 'vip', 'venue_owner']);
    expect(getAssignableRoleKeys('super_admin', custom)).toEqual([
      'user', 'coach', 'captain', 'vip', 'venue_owner', 'admin', 'top', 'super_admin', 'beyond',
    ]);
    expect(canAssignRole(actor('super_admin', 'all'), 'top', custom)).toBe(true);
    expect(canAssignRole(actor('super_admin', 'all'), 'beyond', custom)).toBe(true);
  });

  it('F4：沒有自訂角色清單時只能照內建層級判斷（未知角色視為 0，交給伺服器裁定）', () => {
    const a = actor('admin', 'all');
    expect(canAssignRole(a, 'top')).toBe(true);
    expect(canAssignRole(a, 'admin')).toBe(false);
    expect(canAssignRole(a, 'super_admin')).toBe(false);
  });

  it('F11：roleLabel 對舊資料角色 team_leader 回「領隊」，自訂標籤優先，完全沒有對照才回原字串', () => {
    expect(roleLabel('team_leader', [])).toBe('領隊');
    expect(roleLabel('team_leader', [{ key: 'team_leader', label: '自訂隊長' }])).toBe('自訂隊長');
    expect(roleLabel('mystery_role', [])).toBe('mystery_role');
    expect(roleLabel('coach', [])).toBe('教練');
  });

  it('serverRoleLevel：內建照伺服器表，自訂與未知角色為 0', () => {
    expect(serverRoleLevel('admin')).toBe(4);
    expect(serverRoleLevel('super_admin')).toBe(5);
    expect(serverRoleLevel('vip')).toBe(0);
    expect(serverRoleLevel(null)).toBe(0);
  });
});

describe('buildEditUpdates（A saveUserEdit 的 updates）', () => {
  const a = actor('admin', 'all');
  const base = user({
    role: 'user', region: '台北市', gender: '男', sports: '足球, 籃球', phone: '0912', email: 'a@b.co', birthday: '1990-05-01',
  });

  it('沒有改任何欄位 → no_change（包含 sports 為陣列轉成的文字、生日已是 YYYY-MM-DD）', () => {
    expect(buildEditUpdates(a, base, formValuesFromUser(base))).toEqual({ ok: false, reason: 'no_change' });
  });

  it('只送有改的欄位：電話與 Email', () => {
    const form = { ...formValuesFromUser(base), phone: ' 0988 ', email: 'new@x.io' };
    expect(buildEditUpdates(a, base, form)).toEqual({ ok: true, profileUpdates: { phone: '0988', email: 'new@x.io' }, role: null });
  });

  it('生日改成 YYYY/MM/DD；清空生日送 null', () => {
    expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), birthday: '1991-02-03' }))
      .toEqual({ ok: true, profileUpdates: { birthday: '1991/02/03' }, role: null });
    expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), birthday: '' }))
      .toEqual({ ok: true, profileUpdates: { birthday: null }, role: null });
  });

  it('清空 Email 送 null；清空其他文字欄位送空字串', () => {
    expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), email: '' }))
      .toEqual({ ok: true, profileUpdates: { email: null }, role: null });
    expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), region: '', gender: '' }))
      .toEqual({ ok: true, profileUpdates: { region: '', gender: '' }, role: null });
  });

  it('Email 格式不合或超過 254 字 → invalid_email，一律不送出', () => {
    for (const email of ['abc', 'a@b', 'a b@c.d', `${'x'.repeat(250)}@a.bc`]) {
      expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), email })).toEqual({ ok: false, reason: 'invalid_email' });
    }
  });

  it('改角色：role 有值；與原角色相同則不送', () => {
    expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), role: 'coach' }))
      .toEqual({ ok: true, profileUpdates: {}, role: 'coach' });
    expect(buildEditUpdates(a, base, { ...formValuesFromUser(base), role: 'user' }).ok).toBe(false);
  });

  it('沒有 edit_profile 權限碼時，個人資料欄位被忽略（即使表單被改）', () => {
    const roleOnly = actor('admin', [PERM_USERS_CHANGE_ROLE]);
    const form = { ...formValuesFromUser(base), phone: '0999', role: 'coach' };
    expect(buildEditUpdates(roleOnly, base, form)).toEqual({ ok: true, profileUpdates: {}, role: 'coach' });
  });

  it('沒有 change_role 權限碼時，角色變更被忽略；改了角色但沒有其他變更 → no_change', () => {
    const profileOnly = actor('admin', [PERM_USERS_EDIT_PROFILE]);
    expect(buildEditUpdates(profileOnly, base, { ...formValuesFromUser(base), role: 'coach' })).toEqual({ ok: false, reason: 'no_change' });
    expect(buildEditUpdates(profileOnly, base, { ...formValuesFromUser(base), role: 'coach', phone: '0999' }))
      .toEqual({ ok: true, profileUpdates: { phone: '0999' }, role: null });
  });

  it('admin 對同級角色（admin）：角色變更被忽略，但資料仍可改', () => {
    const adminTarget = user({ role: 'admin', phone: '1' });
    expect(buildEditUpdates(a, adminTarget, { ...formValuesFromUser(adminTarget), role: 'user', phone: '2' }))
      .toEqual({ ok: true, profileUpdates: { phone: '2' }, role: null });
  });

  it('無權限者（user／coach／captain）永遠 no_change', () => {
    for (const role of ['user', 'coach', 'captain']) {
      const none = actor(role, []);
      expect(buildEditUpdates(none, base, { ...formValuesFromUser(base), role: 'coach', phone: '0999' }))
        .toEqual({ ok: false, reason: 'no_change' });
    }
  });
});

describe('操作日誌措辭（operationLogs：type／typeName／content）', () => {
  it('角色變更：type role／角色變更，句型照 A _applyRoleChange（手動晉升／調整）', () => {
    expect(buildRoleChangeOpLog('小明', 'user', 'coach', [])).toEqual({
      type: 'role', typeName: '角色變更', content: '小明 手動晉升為「教練」（原：一般用戶）',
    });
    expect(buildRoleChangeOpLog('小明', 'captain', 'user', [])).toEqual({
      type: 'role', typeName: '角色變更', content: '小明 手動調整為「一般用戶」（原：領隊）',
    });
  });

  it('角色變更：自訂角色用自訂標籤，層級依執行期角色序列判斷晉升或調整', () => {
    const custom = [{ key: 'vip', label: 'VIP', afterRole: 'captain' }];
    expect(buildRoleChangeOpLog('小明', 'coach', 'vip', custom).content).toBe('小明 手動晉升為「VIP」（原：教練）');
    expect(buildRoleChangeOpLog('小明', 'venue_owner', 'vip', custom).content).toBe('小明 手動調整為「VIP」（原：場主）');
  });

  it('限制／解除限制：固定 type user_restrict／帳號限制，動詞放 content', () => {
    expect(buildRestrictionOpLog('小明', true)).toEqual({ type: 'user_restrict', typeName: '帳號限制', content: '限制「小明」' });
    expect(buildRestrictionOpLog('小明', false)).toEqual({ type: 'user_restrict', typeName: '帳號限制', content: '解除限制「小明」' });
  });

  it('資料編輯：只記改了哪些欄位名稱（不記電話、Email 等值）；沒有資料欄位被改回 null', () => {
    const log = buildProfileEditOpLog('小明', { phone: '0912-345-678', email: 'secret@example.com', region: '台北市' });
    expect(log).toEqual({ type: 'user_edit', typeName: '編輯用戶資料', content: '編輯「小明」的資料：地區、聯繫電話、電子郵件' });
    expect(JSON.stringify(log)).not.toMatch(/0912|secret@/);
    expect(buildProfileEditOpLog('小明', {})).toBeNull();
    expect(buildProfileEditOpLog('小明', { birthday: null, sports: '' })?.content).toBe('編輯「小明」的資料：生日、運動類別');
  });
});

describe('applyEditToUser', () => {
  it('把已送出的變更套回該筆，其他欄位不動', () => {
    const before = user({ role: 'user', phone: '1', birthday: '1990-01-01' });
    const after = applyEditToUser(before, { phone: '2', email: null, birthday: '1991/02/03' }, 'coach');
    expect(after).toMatchObject({ role: 'coach', phone: '2', email: '', birthday: '1991-02-03', name: '小明' });
    expect(before.phone).toBe('1');
  });
});
