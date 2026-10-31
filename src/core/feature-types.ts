// 功能 Manifest 型別。新增功能時以此為契約。

export type FeatureStatus = 'enabled' | 'reserved' | 'external';

/** 側邊選單判斷用的登入者權限摘要（結構與 useViewer() 相容，core 不依賴功能模組）。 */
export interface RouteAccessContext {
  uid: string | null;
  role: string;
  /** A 的活動角色等級（含自訂角色插值）。 */
  roleLevel: number;
  capabilities: readonly string[];
  hasPermission: (code: string) => boolean;
  /** 選填：角色層級的權限清單（與 useViewer() 相容）；省略視為無角色層級權限。 */
  permissionSources?: { rolePermissions: readonly string[] | null };
}

export interface FeatureRoute {
  path: string;
  load: () => Promise<{ default: import('preact').ComponentType<any> }>;
  titleKey: string;
  /**
   * 側邊選單是否顯示此入口（照 A 的 DRAWER_MENUS 權限）。未設定＝一律顯示。
   * 只控制選單顯示；頁面本身仍要自行擋權限。
   */
  drawerVisibleIf?: (access: RouteAccessContext) => boolean;
}

export interface FeatureNavItem {
  path: string;
  labelKey: string;
  icon: string;
  order: number;
}

export interface FeatureManifest {
  /** kebab-case，與資料夾同名 */
  id: string;
  /** reserved：架構預留、預設關閉；external：外部系統接入 */
  status: FeatureStatus;
  /** 依賴的其他功能 id */
  dependsOn?: string[];
  routes: FeatureRoute[];
  nav?: FeatureNavItem[];
  /** status 為 external 時使用 */
  externalUrl?: string;
  /** 可操作訊息動態登錄器（actionType -> 載入登錄檔的函式） */
  messageActions?: Record<string, () => Promise<unknown>>;
}
