// 功能 Manifest 型別。新增功能時以此為契約。

export type FeatureStatus = 'enabled' | 'reserved' | 'external';

export interface FeatureRoute {
  path: string;
  load: () => Promise<{ default: import('preact').ComponentType<any> }>;
  titleKey: string;
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
