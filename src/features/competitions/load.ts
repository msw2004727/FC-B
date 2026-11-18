import { FEATURE_OVERRIDES } from '@/feature-overrides';

/** 建置期是否啟用賽事第 2 步。只有 feature-overrides 明確設 true 才算開。 */
export function isCompetitionsEnabled(): boolean {
  return FEATURE_OVERRIDES.competitions === true;
}

export interface CompetitionsLoaders {
  loadFirebase: () => Promise<unknown>;
  loadCallables: () => Promise<unknown>;
  loadRepo: () => Promise<unknown>;
}

/**
 * 開關關閉時直接返回，不執行資料層的動態 import（asia-main／asia-east1 不會被載入）。
 * 回傳 false 表示沒有載入。
 * 預設的 import() 寫在閘門後面，關閉時這三行不會執行。
 */
export async function loadCompetitionsBackend(
  loaders?: CompetitionsLoaders,
): Promise<boolean> {
  if (!isCompetitionsEnabled()) return false;
  const resolved = loaders ?? {
    loadFirebase: () => import('./data/cp-firebase'),
    loadCallables: () => import('./data/cp-callables'),
    loadRepo: () => import('./data/cp-repo'),
  };
  await resolved.loadFirebase();
  await resolved.loadCallables();
  await resolved.loadRepo();
  return true;
}
