# 舊版 A 的 CSS（原檔照搬）

2026-10-19 起 FC-B 改為「架構維持 B、外觀照 A 的 DOM 與 class 輸出」（站長要求、技術顧問 Fable 定案）。
本資料夾的 `.css` 是 A `css/` 的原檔，**不得手改**；要更新就從 A 重新複製，並用 `diff` 確認一致。

| 檔案 | 來源 | 載入方式 |
|------|------|----------|
| base.css | A `css/base.css` | `src/main.tsx` 載入，打包時限定在 `.legacy-ui` 內 |
| layout.css | A `css/layout.css` | 同上 |
| edu-info-btn.css | A `css/education.css` 第 5～12 行（整檔 6000 多行，只抽說明按鈕這段） | 個人頁等用到 `.edu-info-btn` 的頁面自行 import |

**限定範圍**：`scripts/legacy-css-scope.mjs`（Vite PostCSS 外掛）把路徑含 `/legacy/` 的 CSS 選擇器改寫成只作用在 `.legacy-ui` 之內（`:root`、`html`、`body` → `.legacy-ui`；`[data-theme="dark"]` → `[data-theme="dark"] .legacy-ui`）。原因：直接全域載入時，尚未改版、但用了同名 class 的 B 頁面會跑版（2026-10-19 實測「我的活動」分頁列變直排）。頁面改成 A 結構後，在最外層加 `class="legacy-ui"` 即套用。

功能頁專用的 A CSS（例如活動頁的 `activity.css`）放在該功能資料夾，隨路由延遲載入。
