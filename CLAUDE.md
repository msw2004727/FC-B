# CLAUDE.md — FC-B 專案規則（AI 用）

- 本 repo 只放前端，不得部署任何後端。
- 任何 push 需站長授權。
- 資料寫入遵守 FC 的動作級資料契約：有 Callable 一律走 Callable，不實作 A 的 fallback，不移植鎖定邏輯，②a 直寫須有 Rules emulator 測試。
- 新功能一律做成 `src/features/<id>` 模組，並在 `src/features.config.ts` 的 `ALL_FEATURES` 登記。
- 7 語系必須同時更新；`npm run check:i18n` 失敗不得交付。
- 文字一律使用 `<Text>`；例外：原生 `<option>`、`aria-label`／`title` 等屬性文字、`<input>` placeholder 不適用。
- 換行政策：詞與詞之間才換行；只有**單一詞本身比整行還寬**時，容器的 `overflow-wrap: break-word` 才會緊急拆開，這是防破版的最後手段，屬可接受例外。
- 只能使用 `src/styles/tokens.css` 既有的 CSS 變數，不得自創。
- UI 變更須附桌機／手機／亮色／暗色截圖交 AI 設計師審查。
- 性能預算：首頁 JS gzip ≤ 60KB；不得載入未啟用功能的程式碼。
- 不得寫入任何 secret。
- 交付前跑 `npm run check` 與 `npm run build`。
