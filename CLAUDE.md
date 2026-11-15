# CLAUDE.md — FC-B 專案規則（AI 用）

> 最後審閱：2026-11-15。本檔是入口，每次必讀；細則放在 `.claude/rules/`，依下方「改哪裡讀哪份」載入（Claude Code 依 `paths` 自動載入，其他 AI 由 `AGENTS.md` 指引手動讀）。規則與實際程式不一致時，指出差異，不要默默挑一邊當正確。
> 2026-11-15 改版：由單檔 17 條改為「入口＋分領域規則檔」。取代三條過時條文（推送授權、畫面一律照舊版、截圖交 AI 設計師），原因寫在各條；其餘條文原意保留，只是搬到對應規則檔。

## 1. 專案邊界

- 本 repo 是 ToosterX 新站前端（Preact＋Vite＋TypeScript），**只放前端，不得部署任何後端**。Firestore Rules、Storage Rules、Cloud Functions 的正本都在 FC repo；`emulator/` 下的規則是副本，不得手改（見 `data-permissions.md`）。後端與正式資料的動作不在本 repo 做，回 FC repo 照該 repo 的規則。
- 新站是主線，正式網域的版本來源就是本 repo 的 `main`；舊站 A 已凍結。canonical 在 FC 專案 `CLAUDE.md`：R-CTX-007（改版只做新站；既有 bug 與共用項目的處理方式）、R-CTX-008（取捨順序「穩定 → 速度 → 省錢」，簡報與審查結論要寫對這三項的影響）、R-CTX-009（每張卡以「沿用正式網域取代舊站」為前提：不寫死舊站網址、新網址格式新站自己要能解析、公開資源放新站）。
- **設計方針**：資料格式與權限語意照舊站 A。`.legacy-ui` 內的頁面（已照 A 搬過來的）維持 A 的 DOM、class 與文案（做法見 `src/styles/legacy/README.md`）；要改它的外觀、文案或互動屬 UI 改動，先給站長預覽同意才做，未同意前不得以 R-UI-026～045 為由修改。新畫面與新元件用 B 元件與 `src/styles/tokens.css`，不套 `.legacy-ui`，照 `.claude/rules/ui.md`，不回頭拿舊站當標準。新站刻意與 A 不同的行為以現有程式與測試為準，不得為了「照 A」改回去。（取代 2026-10-20「所有畫面、入口、互動與文字都要和舊版 A 相同」：其後已定案新站是 A 的改良版、舊站凍結，原條文會讓改良被當成違規。）
- 畫面文字：不要多餘的副標與說明文字，讓版面自己說明（R-UI-026，全文在 `.claude/rules/ui.md`）。
- **已定案不做或關閉的功能**（介面不得以反灰保留，R-UI-034；動之前先確認）：
  - 不做：SEO 後台、站台主題（`seo-admin`、`site-theme` 目前還註冊著佔位頁，屬待清理的落差，不要照抄這種寫法）；資料修復工具；成就／徽章／稱號／道具欄。
  - 注意：`src/features/data-repair` 資料夾現在放的是**上線中的黑名單管理**，照常維護與測試，不是可刪的殘留。
  - 隱藏或簡化：經驗值顯示關閉；賽事只保留外部連結卡片；收藏與公告由 `src/core/hidden-features.ts` 隱藏；教育課程走簡化版，目前由 `src/features/education/flags.ts` 關著。
- 不得寫入任何 secret；`.env` 不進版控，範例只放 `.env.example`。
- **線上支付預留**：碰到報名／取消／遞補、費用、退款狀態、通知時，只留接點不實作。派工卡要寫「支付預留：有／無／不適用＋做法」；卡上沒寫就停下回報，不自行決定。

## 2. 架構硬規則

- 新功能一律做成 `src/features/<id>` 模組，並在 `src/features.config.ts` 的 `ALL_FEATURES` 登記；不得載入未啟用功能的程式碼。
  - manifest 的 `status` 為 `enabled` 時，登記後一推 `main` 就上線；要先關著出貨用 `reserved`。
  - 路由的 `load` 一律延遲載入；`drawerVisibleIf` 只控制選單顯示，頁面本身仍要自己擋權限。
  - 每個功能要有 `index.test.ts` 與 7 個語系檔。
- 資料寫入遵守 FC 的動作級資料契約：有 Callable 一律走 Callable，不實作 A 的 fallback，不移植鎖定邏輯；直接寫 Firestore 的動作必須有 Rules emulator 測試。細則見 `data-permissions.md`。
- 7 語系必須同時更新，`npm run check:i18n` 失敗不得交付（它檢查 7 個語系檔都在、鍵一致、值非空）。管理／後台畫面只做繁體中文（R-UI-037）：鍵仍要 7 檔齊全，其他語系放繁中原文或既有譯文即可，免的是翻譯與驗收，不是鍵。
- **性能預算**：首頁入口 JS gzip ≤ 60,000 bytes（`npm run check:bundle`，另有「入口＋預先載入」的第二條上限）。新功能先估入口增量，能延遲載入就延遲載入。
- 版號規則與舊版 A 相同（`0.YYYYMMDD{suffix}`，台北日期；當日第一次無後綴，同日再上線 a…z、za…，跨日重置）：每個上線批次在推送前執行一次 `npm run bump-version`（改 `src/version.ts`，並一併重產 `public/sitemap-events.xml`；讀取失敗保留舊檔不擋上線，最後一行「sitemap：重產 N 筆／沿用舊檔」貼進上線紀錄），不得手改；版號顯示在側邊選單底部（同 A 的 `#home-version-tag`）。只改 CI、測試、文件，或不參與打包的腳本，才不必換版號；被 `vite.config.ts` 引用的腳本（`scripts/legacy-css-scope.mjs`、`early-banners-html.ts`、`early-event-html.ts`、`build-meta.mjs`、`robots-public.txt`）算前端改動，要換版號。

## 3. 交付前必跑

| 情況 | 指令 |
| --- | --- |
| 邊改邊驗 | `npx vitest run <測試檔路徑>`（只跑相關檔） |
| 施工者每次交付 | `npm run typecheck`、`npm run check:i18n`、相關測試檔 |
| 上線前（PM 在測試機跑） | `npm run check`（型別＋全套測試＋語系）與 `npm run build` |
| 動到首頁會載入的程式或 `vite.config.ts` | 再加 `npm run check:bundle`；動 `vite.config.ts` 另跑 `npx vitest run scripts/asset-filename-stability.test.mjs` |
| 動到 `emulator/` 或直接寫 Firestore 的程式 | 再加 `npm run check:rules-sync` 與 `npm run test:rules` |
| 動到角色權限對照 | 再加權限三邊對照（做法見 `data-permissions.md`） |

- 全套測試耗時長，在專用測試機跑；施工者不在使用者正在操作的機器上跑全套。
- **不要把 CI 當把關**：完整 CI 只在推 `main`（＝正式上線）、開 PR 或手動觸發時跑，紅燈出現時正式站可能已經換版；其他分支只跑型別與語系；只改 Markdown、`docs/`、`.claude/` 不觸發 CI。CI 會擋型別、全套測試、語系、規則副本雜湊、首頁大小、規則測試；**權限三邊對照 CI 不跑**，「規則副本對正本」只警示不擋。細節與判讀方式見 `testing.md`。

## 4. 上線與授權

- 推 `main` 就是正式上線，**只由 PM 執行**；施工者與審查者不得 push `main`、不得部署、不得改 `public/runtime-config.json`。其他分支的推送只作備份，含截圖或預覽素材的暫時分支不推。
- 流程：外部 AI 初審 → 第二方對內容的**最終 SHA** 交叉審 → 全套測試 → 換版號 → 快轉推送 → 看 CI 全過 → 讀回正式站 `version.json`。施工方不審自己的交件。審過之後只允許再加一個版號 commit（只含 `src/version.ts` 與 `public/sitemap-events.xml`），推送前用 `git diff --stat <審過的 SHA>..HEAD` 核對；多了別的檔就回到審查。（取代原「任何 push 需站長授權」：站長 2026-11-09 改定為審查通過即推、上線後由顧問讀回；逐次授權已不是現行做法。FC 專案 `CLAUDE.md` 的 R-GOV-007 尚未同步這一點，以本條與 `release-update.md` 為準。）
- 改 `runtime-config.json` 的 `minBuild` 或 `swEnabled` 由顧問事前裁定（R-UPD-003；唯一例外見 R-UPD-022）。
- 回退一律 `git revert` 後換新版號再推；不推舊 SHA、不強推、不改寫歷史。
- 一般更新、強制更新、停用離線快取三級的觸發條件、步驟與回退，canonical 在 `.claude/rules/release-update.md`（R-UPD）。動到 R-UPD-041 列管的更新流程檔一律高風險、單獨一批；staging 演練由 PM 安排，施工者不自行上 staging。每個上線批次的紀錄必答「強制更新：是／否」。
- 畫面改動在施工前要先給站長看預覽並同意；選版面只認站長本人（R-UI-038）。

## 5. 改哪裡讀哪份

| 改動範圍 | 規則檔 |
| --- | --- |
| 畫面、樣式、文案、語系檔 | `.claude/rules/ui.md` |
| 資料讀寫、權限、`emulator/` | `.claude/rules/data-permissions.md` |
| 測試與驗證（任何程式改動） | `.claude/rules/testing.md`、`.claude/rules/review-lessons.md` |
| 版號、更新流程、`vite.config.ts`、`index.html`、`scripts/` | `.claude/rules/release-update.md` |

實際觸發範圍以各檔開頭的 `paths` 為準。涉及多列時全部都讀；規則檔缺失時回報，不當作沒有規則。規則引用 FC repo 的條文（R-CTX、R-GOV、R-UI-001～025）而手邊讀不到時，回報，不要猜。

## 6. 做事方式

- 修 bug 先找根因並有證據（重現、log 或測試），再改最少的程式；修完搜尋同樣寫法的其他位置。
- 只改需求需要的檔案，不順手格式化、改名或清理無關程式；本次造成的沒人用的程式要清掉。
- 需求有多種合理解讀時，列出差異讓人選，不自行挑一個實作。派工卡的要求與規則衝突時，停下來回報。
- 說「完成」要附剛跑過的指令與輸出，沒跑的項目明說沒跑；審查意見先核實是否屬實再改。
- 審查別人的交件只讀不改，結論寫 GO／GO with fixes／NO-GO，問題分 P1～P3 並附檔案與行號。
- 檔案一律 UTF-8 無 BOM、行尾 LF；不得混入零寬字元。
- commit 訊息用中文、列關鍵變更。本 repo 是公開的：訊息、分支名與文件都用中性描述，安全相關的修正不寫出弱點細節。
