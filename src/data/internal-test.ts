// 內測模式：只剩角落浮水印（「內測版 · commit」）與搜尋引擎隔離（noindex、robots、X-Robots-Tag）。
// - 正式建置預設就是內測模式；只有建置變數 `VITE_PUBLIC_LAUNCH=1` 才關閉，忘了設也不會被搜尋引擎收錄。
//   `vite dev`／測試預設不套用，需要時設 `VITE_INTERNAL_TEST=1`。
// 2026-10-20 站長取消白名單閘門與寫入守門（取代原「白名單＋[內測] 活動限定＋影響對象限定」三道防護）：
// 任何人都能瀏覽與使用，權限與舊版 A 相同，由 Firestore Rules 與 Callable 把關。

export function isInternalTestMode(): boolean {
  if (import.meta.env.DEV) return import.meta.env.VITE_INTERNAL_TEST === '1';
  return import.meta.env.VITE_PUBLIC_LAUNCH !== '1';
}
