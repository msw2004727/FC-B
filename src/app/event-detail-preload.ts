/** 與 `share-link.ts` 的 PUBLIC_ID、活動路由 `/events/:id` 同一個 id 形狀。 */
const EVENT_PUBLIC_ID = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * pathname 恰為 `/events/<PUBLIC_ID>` 才預先下載詳情 chunk。
 * 其他路徑（首頁、列表、多一段路徑）不下載，避免跟首屏搶頻寬。
 */
export function shouldPreloadEventDetail(pathname: string): boolean {
  const match = /^\/events\/([^/]+)$/.exec(pathname);
  const id = match?.[1];
  return id !== undefined && EVENT_PUBLIC_ID.test(id);
}

/**
 * 只下載模組，不呼叫、不初始化 Firestore、不讀資料。
 * import 失敗（含 iOS `Importing a module script failed`）吞掉，不能再多一個 unhandledrejection。
 * `loadPage` 的靜態 `import()` 必須與 `features/events/index.ts` 的 route `load` 是同一個模組，才會進同一個 chunk。
 */
export function preloadEventDetailChunks(
  pathname: string,
  loadPage: () => Promise<unknown>,
  loadFirestore: () => Promise<unknown>,
): void {
  if (!shouldPreloadEventDetail(pathname)) return;
  void loadPage().catch(() => {});
  void loadFirestore().catch(() => {});
}
