/**
 * 俱樂部表單（TeamFormModal，含 team-form.css 與 activity.css）的延遲載入。
 * `/teams` 與 `/teams/:id` 只在真的要開表單時才下載。
 * 本檔只能用動態 import 取得表單，不得靜態 import 表單模組。
 */

export type TeamFormModalComponent =
  typeof import('./TeamFormModal').TeamFormModal;

let loading: Promise<TeamFormModalComponent> | null = null;

/** 取得（單例）表單元件；失敗時清掉快取以便重試（L-08）。 */
export function loadTeamFormModal(): Promise<TeamFormModalComponent> {
  if (!loading) {
    const promise = import('./TeamFormModal').then((mod) => mod.TeamFormModal);
    loading = promise;
    promise.catch(() => {
      if (loading === promise) loading = null;
    });
  }
  return loading;
}

/** 測試用。 */
export function _resetTeamFormLoaderForTest(): void {
  loading = null;
}
