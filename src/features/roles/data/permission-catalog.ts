import { normalizePermissionCode } from '@/features/profile/data/permissions';

/** 名稱逐字取自 A js/config.js 的抽屜、額外權限及個人資料目錄；授權 allowlist 仍使用共用 permissions.ts。 */
export interface CatalogItem { code: string; name: string }
export interface CatalogCategory { cat: string; minRole?: string | null; items: CatalogItem[] }
export const BUILTIN_CATALOG: readonly CatalogCategory[] = [
  {"cat":"活動管理","minRole":"coach","items":[{"code":"activity.manage.entry","name":"顯示入口"},{"code":"event.create","name":"建立活動"},{"code":"event.edit_self","name":"編輯自己的活動"},{"code":"event.edit_all","name":"編輯所有活動"},{"code":"event.delete_self","name":"刪除自己的活動"},{"code":"event.delete","name":"刪除所有活動"},{"code":"event.publish","name":"上架 / 下架活動"},{"code":"event.scan","name":"掃碼簽到 / 簽退"},{"code":"event.manual_checkin","name":"編輯簽到 / 簽退"},{"code":"event.view_registrations","name":"查看報名名單"}]},
  {"cat":"賽事管理","minRole":"coach","items":[{"code":"admin.tournaments.entry","name":"顯示入口"},{"code":"admin.tournaments.create","name":"建立賽事"},{"code":"admin.tournaments.manage_all","name":"管理所有賽事"},{"code":"admin.tournaments.review","name":"審核參賽申請"},{"code":"admin.tournaments.end","name":"結束賽事"},{"code":"admin.tournaments.reopen","name":"重開賽事"},{"code":"admin.tournaments.delete","name":"刪除賽事"}]},
  {"cat":"俱樂部管理","minRole":"captain","items":[{"code":"team.manage.entry","name":"顯示入口"},{"code":"team.create","name":"建立俱樂部"},{"code":"team.manage_all","name":"管理所有俱樂部"},{"code":"team.manage_self","name":"管理自己的俱樂部"},{"code":"team.review_join","name":"審核入隊申請"},{"code":"team.assign_coach","name":"指派俱樂部教練"},{"code":"team.create_event","name":"建立俱樂部專屬活動"},{"code":"team.toggle_event_visibility","name":"切換活動公開性"}]},
  {"cat":"小遊戲管理","minRole":"admin","items":[{"code":"admin.games.entry","name":"顯示入口"}]},
  {"cat":"用戶管理","minRole":"admin","items":[{"code":"admin.users.entry","name":"顯示入口"},{"code":"admin.users.edit_profile","name":"編輯基本資料"},{"code":"admin.users.change_role","name":"修改用戶身分"},{"code":"admin.users.restrict","name":"限制 / 解除限制"}]},
  {"cat":"首頁管理","minRole":"admin","items":[{"code":"admin.banners.entry","name":"顯示入口"}]},
  {"cat":"二手商品管理","minRole":"admin","items":[{"code":"admin.shop.entry","name":"顯示入口"}]},
  {"cat":"站內信管理","minRole":"admin","items":[{"code":"admin.messages.entry","name":"顯示入口"},{"code":"admin.messages.compose","name":"撰寫廣播"},{"code":"admin.messages.delete","name":"刪除站內信"}]},
  {"cat":"數據儀表板","minRole":"super_admin","items":[{"code":"admin.dashboard.entry","name":"顯示入口"}]},
  {"cat":"SEO 儀表板","minRole":"admin","items":[{"code":"admin.seo.entry","name":"顯示入口"}]},
  {"cat":"佈景主題","minRole":"super_admin","items":[{"code":"admin.themes.entry","name":"顯示入口"}]},
  {"cat":"手動 EXP 管理","minRole":"super_admin","items":[{"code":"admin.exp.entry","name":"顯示入口"}]},
  {"cat":"自動 EXP 管理","minRole":"super_admin","items":[{"code":"admin.auto_exp.entry","name":"顯示入口"}]},
  {"cat":"推播通知設定","minRole":"super_admin","items":[{"code":"admin.notif.entry","name":"顯示入口"},{"code":"admin.notif.toggle","name":"修改推播開關"}]},
  {"cat":"系統公告管理","minRole":"super_admin","items":[{"code":"admin.announcements.entry","name":"顯示入口"}]},
  {"cat":"成就/徽章管理","minRole":"super_admin","items":[{"code":"admin.achievements.entry","name":"顯示入口"}]},
  {"cat":"日誌中心","minRole":"super_admin","items":[{"code":"admin.logs.entry","name":"顯示入口"},{"code":"admin.logs.error_read","name":"錯誤日誌讀取"},{"code":"admin.logs.error_delete","name":"錯誤日誌清除"},{"code":"admin.logs.audit_read","name":"稽核日誌讀取"}]},
  {"cat":"用戶補正管理","minRole":"admin","items":[{"code":"admin.repair.entry","name":"顯示入口"},{"code":"admin.repair.team_join_repair","name":"歷史入隊補正"},{"code":"admin.repair.no_show_adjust","name":"放鴿子修改"},{"code":"admin.repair.data_sync","name":"系統資料同步 / UID檢查"},{"code":"admin.repair.event_blocklist","name":"活動黑名單"},{"code":"activity.view_noshow","name":"查看放鴿子次數"}]},
  {"cat":"無效資料查詢","minRole":"super_admin","items":[{"code":"admin.inactive.entry","name":"顯示入口"}]},
  {"cat":"個人資料功能","minRole":null,"items":[{"code":"profile.secondary_identity","name":"第二身份"}]},
];

/**
 * 一般用戶的開關（前台活動能力 roleActivityCapabilities/user）。名稱照站長 11-23 選定的方案乙預覽
 * （permissions-health-preview-2026-11-23.html）；取代原「基本建立活動」等舊名，並補上原本漏列的 team_create 與新增的站內賽事主辦。
 */
export const CAPABILITY_ITEMS: readonly CatalogItem[] = [
  {"code":"user.activity.basic_create","name":"建立活動"},
  {"code":"user.activity.external_create","name":"建立外部活動連結"},
  {"code":"user.activity.own_manage_entry","name":"自己活動的管理入口"},
  {"code":"user.activity.own_edit_basic","name":"編輯自己的活動"},
  {"code":"user.activity.own_cancel","name":"取消自己的活動"},
  {"code":"user.activity.site_operate","name":"現場簽到與候補"},
  {"code":"user.activity.delegate_assign","name":"設定委託人"},
  {"code":"user.activity.addons_use","name":"進階欄位（加值服務）"},
  {"code":"user.activity.team_create","name":"建立俱樂部"},
  {"code":"user.competition.host","name":"以個人身分主辦賽事"},
];

/** 一般用戶頁的分組（只是顯示；資料仍在同一份 capabilities 陣列）。 */
export const CAPABILITY_GROUPS: readonly { key: 'activity' | 'club' | 'competition'; codes: readonly string[] }[] = [
  { key: 'activity', codes: CAPABILITY_ITEMS.slice(0, 8).map(item => item.code) },
  { key: 'club', codes: ['user.activity.team_create'] },
  { key: 'competition', codes: ['user.competition.host'] },
];

/** 教練以上的「站內賽事」組；不在 BUILTIN_CATALOG 裡，避免影響 aBuiltinDefaults（每組第一個碼當入口預設）。 */
export const COMPETITION_CATEGORY: CatalogCategory = {
  cat: '站內賽事', minRole: null, items: [{ code: 'competition.host', name: '主辦賽事（個人／俱樂部）' }],
};

/**
 * 健康檢查 2026-11-23 §2.2：新站 src 沒有任何地方判斷的碼（舊站或後端可能仍用），權限頁標「新站未使用」。
 * 用 grep 核對：排除測試、locales、dev 與權限目錄本身後沒有引用。新站開始判斷某碼時要從這裡拿掉。
 */
export const UNUSED_IN_B_CODES: ReadonlySet<string> = new Set([
  'event.publish', 'event.view_registrations', 'team.manage_self', 'admin.games.entry', 'admin.shop.entry',
  'admin.exp.entry', 'admin.auto_exp.entry', 'admin.achievements.entry', 'admin.logs.error_delete',
  'admin.repair.data_sync',
]);
/**
 * 健康檢查 2026-11-23 P2-1、P2-4、P2-7～P2-9：後端（Rules／Callable）對這些角色層級不看開關、一律放行。
 * 權限頁標「後端固定放行」；開關照常可切，因為它仍控制新站按鈕（站長 11-23 按鈕選 (a)，取代預覽的「此角色固定擁有、不能切」）。
 * minLevel 對照 BASE_ROLE_LEVEL_MAP：coach＝1、admin＝4。
 */
export const BACKEND_FIXED_GRANTS: readonly { code: string; minLevel: number }[] = [
  { code: 'activity.manage.entry', minLevel: 1 }, { code: 'event.create', minLevel: 1 },
  ...['event.delete', 'admin.notif.toggle', 'admin.banners.entry', 'admin.announcements.entry', 'admin.achievements.entry',
    'admin.themes.entry', 'admin.games.entry', 'admin.shop.entry', 'admin.dashboard.entry'].map(code => ({ code, minLevel: 4 })),
];
/** 新站沒有對應功能的一般用戶開關（新站沒有建立外部活動的入口）。 */
export const NO_FEATURE_IN_B_CAPABILITIES: ReadonlySet<string> = new Set(['user.activity.external_create']);

/** 舊站賽事（友誼賽）專用、新站沒用到的 6 個碼：收進「舊站專用」組。碼不刪，舊站與個別授權資料照舊。 */
export const LEGACY_ONLY_CODES: ReadonlySet<string> = new Set([
  'admin.tournaments.entry', 'admin.tournaments.create', 'admin.tournaments.review',
  'admin.tournaments.end', 'admin.tournaments.reopen', 'admin.tournaments.delete',
]);
const TOURNAMENT_CATEGORY = '賽事管理';
export const EXTERNAL_CARDS_CATEGORY = '外部賽事卡片';
export const LEGACY_CATEGORY = '舊站專用';
const DISPLAY_NAMES: Readonly<Record<string, string>> = { 'admin.tournaments.manage_all': '新增 / 編輯 / 刪除卡片' };

/**
 * 權限頁的顯示分組（只改畫面，不改 mergePermissionCatalog 與預設權限）：
 * 「賽事管理」改名「外部賽事卡片」、只留新站有判斷的 manage_all；舊站專用 6 碼移到最後一組；
 * 「站內賽事」插在第一組之後。
 */
export function displayPermissionCatalog(remote: readonly CatalogCategory[] = []): CatalogCategory[] {
  const legacy: CatalogItem[] = [];
  const result: CatalogCategory[] = [];
  for (const category of mergePermissionCatalog(remote)) {
    const kept = category.items.filter(item => {
      if (!LEGACY_ONLY_CODES.has(item.code)) return true;
      legacy.push(item);
      return false;
    }).map(item => DISPLAY_NAMES[item.code] ? { ...item, name: DISPLAY_NAMES[item.code] as string } : item);
    if (!kept.length) continue;
    result.push(category.cat === TOURNAMENT_CATEGORY ? { ...category, cat: EXTERNAL_CARDS_CATEGORY, items: kept } : { ...category, items: kept });
    if (result.length === 1) result.push({ ...COMPETITION_CATEGORY, items: [...COMPETITION_CATEGORY.items] });
  }
  if (legacy.length) result.push({ cat: LEGACY_CATEGORY, minRole: null, items: legacy });
  return result;
}

/** A getMergedPermissionCatalog：內建優先，遠端只補未出現的啟用碼，同分類合併。 */
export function mergePermissionCatalog(remote: readonly CatalogCategory[] = []): CatalogCategory[] {
  const result = BUILTIN_CATALOG.map(category => ({ ...category, items: category.items.map(item => ({ ...item })) }));
  const assigned = new Set(result.flatMap(category => category.items.map(item => item.code)));
  for (const category of remote) {
    const items = category.items.filter(item => {
      if (!item.code || normalizePermissionCode(item.code) !== item.code || assigned.has(item.code)) return false;
      assigned.add(item.code);
      return true;
    });
    if (!items.length) continue;
    const existing = result.find(item => item.cat === category.cat);
    if (existing) existing.items.push(...items);
    else result.push({ ...category, items: [...items] });
  }
  return result;
}

export function permissionName(code: string, remote: readonly CatalogCategory[] = []): string {
  for (const category of mergePermissionCatalog(remote)) {
    const item = category.items.find(entry => entry.code === code);
    if (item) return code.endsWith('.entry') ? category.cat + '（入口）' : item.name;
  }
  const cap = CAPABILITY_ITEMS.find(item => item.code === code)
    ?? COMPETITION_CATEGORY.items.find(item => item.code === code);
  if (cap) return cap.name;
  const normalized = normalizePermissionCode(code);
  if (normalized && normalized !== code) return permissionName(normalized, remote) + '（' + code + '）';
  return code;
}
