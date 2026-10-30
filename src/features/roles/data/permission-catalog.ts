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

export const CAPABILITY_ITEMS: readonly CatalogItem[] = [
  {"code":"user.activity.basic_create","name":"基本建立活動"},
  {"code":"user.activity.external_create","name":"建立外部活動連結"},
  {"code":"user.activity.own_manage_entry","name":"自己活動管理入口"},
  {"code":"user.activity.own_edit_basic","name":"編輯自己活動基本資料"},
  {"code":"user.activity.own_cancel","name":"取消自己活動"},
  {"code":"user.activity.site_operate","name":"現場簽到與候補操作"},
  {"code":"user.activity.delegate_assign","name":"設定委託人"},
  {"code":"user.activity.addons_use","name":"使用進階功能（加值服務）"},
];

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
  const cap = CAPABILITY_ITEMS.find(item => item.code === code);
  if (cap) return cap.name;
  const normalized = normalizePermissionCode(code);
  if (normalized && normalized !== code) return permissionName(normalized, remote) + '（' + code + '）';
  return code;
}
