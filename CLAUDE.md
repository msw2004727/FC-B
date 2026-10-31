# CLAUDE.md — FC-B 專案規則（AI 用）

- 本 repo 只放前端，不得部署任何後端。
- 任何 push 需站長授權。
- **設計方針（2026-10-20 站長定案）**：新版所有畫面、入口、互動與文字都要和舊版 A 相同；新舊只差在架構、輕量化、速度與穩定性。做法是輸出 A 的 DOM 與 class、照搬 A 的 CSS 原檔（見 `src/styles/legacy/README.md`），不另行設計。
- 版號規則與舊版 A 相同（`0.YYYYMMDD{suffix}`，台北日期；當日第一次無後綴，同日再上線 a…z、za…，跨日重置）：每個上線批次在推送前執行一次 `npm run bump-version`（只改 `src/version.ts`），不得手改；版號顯示在側邊選單底部（同 A 的 `#home-version-tag`）。
- 資料寫入遵守 FC 的動作級資料契約：有 Callable 一律走 Callable，不實作 A 的 fallback，不移植鎖定邏輯，②a 直寫須有 Rules emulator 測試。
- 新功能一律做成 `src/features/<id>` 模組，並在 `src/features.config.ts` 的 `ALL_FEATURES` 登記。
- 7 語系必須同時更新；`npm run check:i18n` 失敗不得交付。
- 尚未改成 A 外觀的 B 頁面：文字使用 `<Text>`；已改成 A 外觀的頁面（`.legacy-ui` 內）不要用 `<Text>`（它的斷詞會破壞 A 的單行省略），文字照 A 原文，A 有翻譯鍵的用 `lt()`。
- 換行政策：詞與詞之間才換行；只有**單一詞本身比整行還寬**時，容器的 `overflow-wrap: break-word` 才會緊急拆開，這是防破版的最後手段，屬可接受例外。
- 只能使用既有的 CSS 變數，不得自創：B 元件用 `src/styles/tokens.css`；A 外觀頁面用 A 原檔的變數（`src/styles/legacy-vars.css`）。
- UI 變更須附桌機／手機／亮色／暗色截圖交 AI 設計師審查。
- 性能預算：首頁 JS gzip ≤ 60KB；不得載入未啟用功能的程式碼。
- 不得寫入任何 secret。
- 交付前跑 `npm run check` 與 `npm run build`。
- 舊站 A 維護模式、新站 FC-B 主線；改版取捨順序「穩定 → 速度 → 省錢」。canonical 規則在 FC 專案 `CLAUDE.md` 的 R-CTX-007（只做新站、舊站僅修既有 bug 或動共用項目）與 R-CTX-008（穩定／速度／省錢順序）；簡報與審查結論要寫對這三項的影響。
