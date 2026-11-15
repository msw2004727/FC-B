# CLAUDE.md — FC-B 專案規則（AI 用）

> 最後審閱：2026-11-15。本檔是入口，每次必讀；細則放在 `.claude/rules/`，依下方「改哪裡讀哪份」載入（Claude Code 依 `paths` 自動載入，其他 AI 由 `AGENTS.md` 指引手動讀）。規則與實際程式不一致時，指出差異，不要默默挑一邊當正確。
> 2026-11-15 改版：由單檔 19 條改為「入口＋分領域規則檔」。取代三條過時條文（推送授權、畫面一律照舊版、截圖交 AI 設計師），原因寫在各條；其餘條文原意保留，只是搬到對應規則檔。

## 1. 專案邊界

- 本 repo 是 ToosterX 新站前端（Preact＋Vite＋TypeScript），**只放前端，不得部署任何後端**。Firestore Rules、Storage Rules、Cloud Functions 的正本都在 FC repo；`emulator/` 下的規則是副本，不得手改（見 `data-permissions.md`）。
- 新站是主線，正式網域的版本來源就是本 repo 的 `main`；舊站 A 已凍結。canonical 在 FC 專案 `CLAUDE.md`：R-CTX-007（改版只做新站；既有 bug 與共用項目的處理方式）、R-CTX-008（取捨順序「穩定 → 速度 → 省錢」，簡報與審查結論要寫對這三項的影響）、R-CTX-009（每張卡以「沿用正式網域取代舊站」為前提：不寫死舊站網址、新網址格式新站自己要能解析、公開資源放新站）。
- **設計方針**：資料格式、權限語意、既有流程照舊站 A；已照 A 搬過來的畫面（`.legacy-ui` 內）維持 A 的 DOM、class 與文案（做法見 `src/styles/legacy/README.md`）。新畫面、新元件與改良以新站為主，照 `.claude/rules/ui.md`，不回頭拿舊站當標準。（取代 2026-10-20「所有畫面、入口、互動與文字都要和舊版 A 相同」：其後已定案新站是 A 的改良版、舊站凍結，原條文會讓改良被當成違規。）
- **已定案不做或關閉的功能**（資料夾可能還在，動之前先確認，介面不得以反灰保留，R-UI-034）：SEO 後台、站台主題、資料修復工具、成就／徽章／稱號／道具欄；經驗值隱藏；賽事只保留外部連結卡片；收藏與公告由 `src/core/hidden-features.ts` 隱藏。教育課程走簡化版。
- 不得寫入任何 secret；`.env` 不進版控，範例只放 `.env.example`。
- **線上支付預留**：碰到報名／取消／遞補、費用、退款狀態、通知時，只留接點不實作；有費用或報名的畫面出預覽前先問要不要留付款按鈕位置。

## 2. 架構硬規則

- 新功能一律做成 `src/features/<id>` 模組，並在 `src/features.config.ts` 的 `ALL_FEATURES` 登記；不得載入未啟用功能的程式碼。
- 資料寫入遵守 FC 的動作級資料契約：有 Callable 一律走 Callable，不實作 A 的 fallback，不移植鎖定邏輯；直接寫 Firestore 的動作必須有 Rules emulator 測試。細則見 `data-permissions.md`。
- 7 語系必須同時更新，`npm run check:i18n` 失敗不得交付；管理／後台畫面只做繁體中文（R-UI-037）。
- **性能預算**：首頁入口 JS gzip ≤ 60,000 bytes（`npm run check:bundle`，另有「入口＋預先載入」的第二條上限）。新功能先估入口增量，能延遲載入就延遲載入。
- 版號規則與舊版 A 相同（`0.YYYYMMDD{suffix}`，台北日期；當日第一次無後綴，同日再上線 a…z、za…，跨日重置）：每個上線批次在推送前執行一次 `npm run bump-version`（改 `src/version.ts`，並一併重產 `public/sitemap-events.xml`；讀取失敗保留舊檔不擋上線，最後一行「sitemap：重產 N 筆／沿用舊檔」貼進上線紀錄），不得手改；版號顯示在側邊選單底部（同 A 的 `#home-version-tag`）。只改 CI、測試、腳本、文件的批次不必換版號。

## 3. 交付前必跑

| 情況 | 指令 |
| --- | --- |
| 邊改邊驗 | `npx vitest run <測試檔路徑>`（只跑相關檔） |
| 每次交付 | `npm run check`（型別＋全套測試＋語系）與 `npm run build` |
| 動到首頁會載入的程式 | 再加 `npm run check:bundle` |
| 動到 `emulator/` 或直接寫 Firestore 的程式 | 再加 `npm run check:rules-sync` 與 `npm run test:rules` |
| 動到角色權限對照 | 再加 `npm run check:parity`（需要旁邊有 FC repo） |

雲端 CI 會擋上述全部；本機少跑一項，推上去就是紅燈。全套測試耗時長，細節與判讀方式見 `testing.md`。

## 4. 上線與授權

- 推 `main` 就是正式上線。流程：外部 AI 初審 → 第二方對**最終 SHA** 交叉審 → 全套測試 → 換版號 → 快轉推送 → 看 CI 全過 → 讀回正式站 `version.json`。施工方不審自己的交件。（取代原「任何 push 需站長授權」：站長 2026-11-09 改定為審查通過即推、上線後讀回；逐次授權已不是現行做法。）
- 仍須事先裁定的動作：改 `runtime-config.json` 的 `minBuild` 或 `swEnabled`、任何後端或正式資料的動作。
- 回退一律 `git revert` 後換新版號再推；不推舊 SHA、不強推、不改寫歷史。
- 一般更新、強制更新、停用離線快取三級的觸發條件、步驟與回退，canonical 在 `.claude/rules/release-update.md`（R-UPD）。動到更新流程列管檔（`vite.config.ts` 的分塊與 workbox 設定、`sw-control.ts`、`reload-safety.ts`、`force-update.ts`、`submit-guard.ts`、`chunk-reload.ts`）一律高風險、單獨一批（R-UPD-041）。每個上線批次的紀錄必答「強制更新：是／否」。
- 畫面改動在施工前要先給站長看預覽並同意；選版面只認站長本人（R-UI-038）。

## 5. 改哪裡讀哪份

| 改動範圍 | 規則檔 |
| --- | --- |
| 畫面、樣式、文案、語系檔 | `.claude/rules/ui.md` |
| `src/data/**`、各功能的 `data/`、`emulator/**` | `.claude/rules/data-permissions.md` |
| 任何 `src/**`、`scripts/**`（測試與驗證） | `.claude/rules/testing.md`、`.claude/rules/review-lessons.md` |
| 版號、更新流程、`vite.config.ts`、`index.html`、`scripts/**` | `.claude/rules/release-update.md` |

涉及多列時全部都讀。規則檔缺失時回報，不當作沒有規則。

## 6. 做事方式

- 修 bug 先找根因並有證據（重現、log 或測試），再改最少的程式；修完搜尋同樣寫法的其他位置。
- 只改需求需要的檔案，不順手格式化、改名或清理無關程式；本次造成的沒人用的程式要清掉。
- 需求有多種合理解讀時，列出差異讓人選，不自行挑一個實作。
- 說「完成」要附剛跑過的指令與輸出；審查意見先核實是否屬實再改。
- commit 訊息用中文、列關鍵變更。本 repo 是公開的：訊息、分支名與文件都用中性描述，安全相關的修正不寫出弱點細節。
