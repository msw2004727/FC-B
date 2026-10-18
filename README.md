# FC-B — ToosterX 前端（B 版）

ToosterX 運動活動報名平台的全新前端（B 版），為 A 版的接班專案。
**本 repo 只放前端**；與 FC 共用 Firestore、Firestore Rules、Cloud Functions。

## 技術棧

- **框架**：Preact 10 + preact-iso（路由）
- **建置**：Vite 8
- **語言**：TypeScript（strict、`noUncheckedIndexedAccess`）
- **測試**：Vitest + jsdom + @testing-library/preact
- **樣式**：純 CSS + Design Tokens（`src/styles/tokens.css`），不使用 CSS-in-JS、UI 函式庫、狀態管理函式庫、圖示字型、網路字型

## 換行政策

詞與詞之間才換行；只有**單一詞本身比整行還寬**時，容器的 `overflow-wrap: break-word` 才會緊急拆開，這是防破版的最後手段，屬可接受例外。

## 語系字典載入

字典目前每語系合併成一個 chunk（約 1–2KB gzip），超過 20KB 時再改為依頁面載入。

## 指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 啟動開發伺服器 |
| `npm run build` | 型別檢查 + 生產建置 |
| `npm run preview` | 預覽生產建置 |
| `npm run typecheck` | 僅做型別檢查 |
| `npm run test` | 執行 Vitest |
| `npm run check:i18n` | 檢查 7 語系 key 集合是否一致 |
| `npm run check` | 依序執行 typecheck → test → check:i18n |

## 資料夾結構

```
src/
  main.tsx                 # 進入點：註冊功能、初始化主題與語系、掛載 App
  app/App.tsx              # 路由外框、TopBar、BottomNav、404
  core/
    feature-types.ts       # 功能 Manifest 型別
    feature-registry.ts    # 功能註冊表（啟用判斷、路由、導覽）
    events.ts              # 型別安全事件匯流排
    theme.ts               # 主題（light / dark / system）
  features.config.ts       # 建置期功能開關 + ALL_FEATURES
  i18n/
    locales.ts             # Locale 清單與顯示名稱
    i18n.ts                # 語系初始化、t()、useT()、格式化
    messages/<locale>.json # 核心字串（7 語系）
  ui/
    Text.tsx               # 換行處理（zh / ja 淺切詞）
    segmenter-fallback-words.ts
    Icon.tsx / TopBar.tsx / BottomNav.tsx / PlaceholderPage.tsx
  styles/
    tokens.css             # 由設計規範產生並提交進版控，修改需經 AI 設計師審查
    base.css               # Reset / 版面 / 換行規則
  features/<id>/
    index.ts               # 匯出 manifest
    locales/<locale>.json  # 功能字串（7 語系，key 為 title / nav）
    pages/                 # 功能頁（若有實作）
scripts/check-i18n.mjs     # 語系 key 檢查
```

## 新增功能

1. 建立 `src/features/<kebab-id>/` 資料夾。
2. 撰寫 `index.ts` 匯出 `manifest: FeatureManifest`（含 `id`、`status`、`routes`、`nav?`、`dependsOn?`、`externalUrl?`）。
3. 補齊 `locales/<locale>.json` × 7（至少 `title`、`nav`）。
4. 到 `src/features.config.ts` 的 `ALL_FEATURES` 加入 manifest。
5. 撰寫測試，並執行 `npm run check`。

## 關閉功能

- **建置期**：在 `src/features.config.ts` 的 `FEATURE_OVERRIDES` 加入 `<id>: false`；對 `reserved` 功能則設 `<id>: true` 才會開啟。
- **執行期**：呼叫 `setRemoteFlags({ <id>: false })`（預設全部 `true`）。任一個 `dependsOn` 被關閉，依賴它的功能也會自動關閉。
- 未啟用功能的路由 chunk 不會被下載。
