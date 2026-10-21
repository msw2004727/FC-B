# FC-B 交接文件

> 最後更新：2026-10-21（PM 交接版）。這份是**公開版**，只放本來就公開或不具風險的資訊。秘密（密碼、token、金鑰）一律不寫；需要的人向站長索取權限，不要把值貼進 repo。

## 1. 這是什麼

- **ToosterX** 是運動活動報名與管理系統（活動、俱樂部、教育課程、QR 簽到、個人統計、管理後台）。
- **A（舊站）**：repo `msw2004727/FC`，網域 `toosterx.com`，Vanilla JS。Firestore Rules 與 Cloud Functions **只放在 FC repo**。
- **B（本 repo，FC-B）**：A 的接班版前端，目標是更快、更穩、模組化。**和 A 共用同一個 Firebase 專案（同一份資料、同一套 Rules 與 Functions）**，所以寫入的資料格式必須和 A 完全相同。B 穩定後主網域切到 B，A 下線。

## 2. 環境與識別碼

| 項目 | 值 | 說明 |
|---|---|---|
| Firebase 專案 | `fc-football-6c8dc` | 前端公開設定在 `src/data/firebase-config.ts`（公開 client 設定，不是秘密） |
| Cloud Functions region | `asia-east1` | 所有 Callable 都在這個 region |
| B 內測網域 | `next.toosterx.com` | 已加入 Firebase Auth 授權網域（2026-10-19） |
| B 部署平台 | Cloudflare Pages 專案 `fc-b`（`fc-b.pages.dev`） | 2026-10-19 建立；連本 repo `main` 自動建置（push 即部署）。建置 `npm run build`、輸出 `dist`、環境變數 `NODE_VERSION=22`、`VITE_LIFF_ID`、`VITE_CALLABLE_MODE=live`（舊的 `VITE_INTERNAL_TEST_UID_HASHES` 已不使用，可從平台刪除）。自訂網域 `next.toosterx.com`（CNAME → `fc-b.pages.dev`，Cloudflare 代理） |
| **B 的 LIFF ID** | `2009084941-3WHCMLLn` | LIFF app「ToosterX Next」，Endpoint `https://next.toosterx.com/`，Full，scopes `openid`＋`profile`，加好友 On (aggressive) |
| B 的 LIFF 所屬 channel | `2009084941`（LINE Login「FC 足球報名系統」） | |
| A 的 LIFF ID | `2009525300-AuPGQ0sh` | A 是 **LINE MINI App**（MINI App 不能另加 LIFF，所以 B 的 LIFF 建在同 provider 的 Login channel） |

**登入**：LIFF 取得 access token → Callable `createCustomToken`（用 LINE `/v2/profile` 換 userId，簽發 Firebase custom token，UID = LINE userId）。B 的 LIFF 與 A 的 MINI App 在**同一個 LINE provider**，所以同一個人的 LINE userId 相同，B 與 A 是同一批帳號。`createCustomToken` 不檢查 channel，但會拒絕 localhost 來源（本機開發一律用 Auth emulator）。

## 3. 建置環境變數

| 變數 | 用途 |
|---|---|
| `VITE_LIFF_ID` | LIFF ID（正式建置時由平台注入，見上表） |
| `VITE_FIREBASE_EMULATOR` | `1` 時開發模式連本機 emulator；正式建置一律忽略 |
| `VITE_CALLABLE_MODE` | `live`（正式 Callable）或 `mock`（測試用假實作） |
| `VITE_PUBLIC_LAUNCH` | **不設＝內測模式**（正式建置預設：角落浮水印＋noindex）；只有正式上線才設 `1` |
| `VITE_INTERNAL_TEST` | 只在 `vite dev` 有效：`1` 時本機也套用內測模式（測試閘門用） |

範本見 `.env.example`。

## 4. 本機開發

```bash
npm install
npm run emulators          # Firestore 8080、Auth 9099（不得連正式資料庫）
npm run seed:emulator      # 寫入固定 ID 的種子資料
VITE_FIREBASE_EMULATOR=1 npx vite --port 5181
npm run check              # 型別＋完整測試＋i18n
```

種子帳號（假 UID，只存在 emulator）：user1 `U…0001`、coach `U…0002`（俱樂部 A 隊長，角色 coach）、admin `U…0003`（俱樂部 B 隊長）、blocked `U…0004`。瀏覽器中用 `import('/src/data/auth.ts').then(m => m.devSignIn(uid))` 登入 emulator。

## 4.1 內測模式（next.toosterx.com）

正式建置在 `VITE_PUBLIC_LAUNCH` 不是 `1` 時是內測模式，只剩兩件事（程式：`src/data/internal-test.ts`、`vite.config.ts` 的 `internalTestNoIndex`）：

- **角落浮水印**：畫面右下角「內測版 · 短 commit · 連線目標」（Cloudflare 建置用 `CF_PAGES_COMMIT_SHA`）。
- **搜尋引擎隔離**：建置時注入 `noindex` meta，輸出 `robots.txt`（全站 Disallow）與 Cloudflare `_headers`（`X-Robots-Tag`）。是否讓 Google 收錄另由站長決定。

**2026-10-20 站長取消白名單閘門與寫入守門**（取代 2026-10-19 的三道防護）：任何人（含訪客）都能瀏覽與使用，新舊站是同一份正式資料的兩個入口，權限與舊版 A 完全相同，由 Firestore Rules 與 Callable 把關。B 的寫入格式仍必須與 A 一致。

### 正式上線收尾清單

1. Cloudflare Pages 設 `VITE_PUBLIC_LAUNCH=1`，重新建置。
2. 確認建置輸出沒有 `robots.txt` 的全站 Disallow、`_headers` 與 noindex meta，畫面沒有「內測版」角標（`src/data/internal-test.test.ts`、`src/app/App.internal-test.test.tsx` 已有單元測試；建置輸出要再人工看一次）。
3. 站長在舊版刪除內測期間建立的 [內測] 測試活動與測試俱樂部。
4. 正式網域的 sitemap／SEO 另案處理。

## 5. 架構重點

- **功能模組**：`src/features/<功能>/`，各自有 `index.ts`（manifest：路由、導覽、`messageActions`）、`data/`、`pages/`、`locales/`（7 語：繁中、簡中、英、日、越、泰、韓，必須同步）。功能可個別開關（`src/core/feature-registry.ts`）。
- **可操作訊息**：收件匣不 import 功能模組；功能在 manifest 宣告 `messageActions`，收件匣用 `ensureMessageAction` 動態載入（`src/core/action-registry.ts`）。
- **資料契約**：動作級契約在 `src/data/contract/callables.ts`。原則：有 Callable 一律走 Callable；直寫的 payload 照 A 並用 FC 的 `tests/firestore-rules/b-contract/` 做 Rules emulator 測試；含衍生欄位或副作用的動作不直寫。
- **共用模組**：站內信投遞一律用 `src/data/inbox-delivery.ts`（欄位照 A）。
- **權限**：照 A 前端 helper 語意。可見性（V 階段）與自有活動操作（O 階段）已用 A 的真實函式做差分測試（fixture 在 `src/features/events/data/__fixtures__/`）；後台完整權限（P 階段）尚未完成。
- **UI 文字規則**：可以換行但詞不能從中間斷開（`<Text>` 元件用 `Intl.Segmenter`）。

## 6. 規則與檢查

- 專案規則：`CLAUDE.md`、`.claude/rules/`（審查教訓 `review-lessons.md`）。FC repo 的 `CLAUDE.md` 是 A 與共用後端的規則來源。
- Rules 同步：`npm run sync:rules` 從 FC 複製 `firestore.rules` 到 `emulator/`（記錄來源 hash），`npm run check:rules-sync` 檢查是否一致。
- 權限同步：`npm run check:parity ../FC` 檢查 `INHERENT_ROLE_PERMISSIONS` 三邊一致。

## 7. 目前狀態（2026-10-21）

- **最新推送**：`main` = `3786ec0`，版號 `0.20261020b`，已在 next.toosterx.com。`npm run check` 2118 個測試全綠。
- **版號規則**：與舊版同位置（側邊抽屜底部 `#home-version-tag`）、同格式 `0.YYYYMMDD{字尾}`（台北日期）。每次推送前 `npm run bump-version`，檢查全綠才推（`&&` 串接，不可用 `;`）。
- **設計方針（站長 2026-10-20）**：所有畫面、入口、互動、文字照舊版 A；只改架構、輕量、速度與穩定。UI/UX 盤點 213 項（166 項照舊版、47 項不改變習慣的優化），清單在 FC 的 local-only `docs/specs/lite-convergence/p75-uiux/`，分 9 批施工：
  - 第 1 批外框（抽屜、頂部列、運動篩選、QR 彈窗、PWA）：已上線。
  - 第 2 批共用互動（提示、確認框、彈窗、返回鍵、換頁載入、登入導向、列表返回停在原位、字級、輸入框不放大）：已上線（`37eacaa`、`ba30363`）。
  - 第 3～9 批：活動詳情與報名、簽到、建立活動表單、個人頁其餘卡片與收件匣、俱樂部、首頁其餘、缺少的頁面。尚未開始。
- **速度**：開頁骨架與實際畫面同幾何；Firestore SDK 不在首屏路徑（動態載入）；Service Worker（vite-plugin-pwa，遠端開關 `/runtime-config.json`）；實測冷開首屏約 1.0 秒、再開 0.1～0.2 秒、斷網可開。
- **經驗值**：照站長決定只關顯示（`src/core/exp-display.ts` 的 `SHOW_EXP=false`），經驗值仍照常累計。

## 8. 旗標與開關

| 旗標 | 位置 | 現值 | 說明 |
|---|---|---|---|
| `CALLABLES_DEPLOYED` | `src/data/callables-deployed.ts` | `false` | 7 支新 Callable 已於 2026-10-20 部署到 FC，但 B 的「名單結算 → `confirmEventAttendance` → 依名單調整經驗值（決定性 requestId）」路徑還沒寫完，所以先不開；開之前要補實作與測試 |
| `SHOW_EXP` | `src/core/exp-display.ts` | `false` | 只隱藏經驗值顯示 |
| `VITE_PUBLIC_LAUNCH` | Cloudflare 環境變數 | 未設 | 未設＝內測模式（見 4.1 的現況說明） |
| `swEnabled`／`minBuild` | `public/runtime-config.json` | `true`／`0` | SW 遠端開關；卡舊版時改這個檔即可，不必重新部署程式 |

## 9. 尚未完成、上線前要做的事

- 第 3～9 批 UI 照舊版（見第 7 節）。
- 活動管理剩餘：降級／強制遞補（需新 Callable）、名單結算（開 `CALLABLES_DEPLOYED`）、放鴿子欄、隊伍排序、委託人編輯、隊伍保留名額快速調整、對外分享、左右滑切分頁。
- 後台完整權限（P 階段）→ 收件匣的入隊核准按鈕要等它。
- 教育課程、通知、個人儀表板、後台功能。
- A 的缺點掃描（FC `p72-a-defects`，三份）合併成一份清單讓站長勾選，勾選項在 B 改良（資料與權限語意仍照 A）。
- Firestore 複合索引（若 B 有新查詢）與 FC 一起部署。

## 10. 已知風險

- **任何 `vite build` 都是正式環境**，會直連正式 Firestore；預覽打包讀資料前必須確認連線目標。本機開發一律 `VITE_FIREBASE_EMULATOR=1` 連 emulator。
- **每次推送 `main` 都會自動部署內測站**；推送前檢查必須全綠。
- 整包測試時第一次動態載入大模組較慢，曾偶發逾時；已把全站 `testTimeout` 放寬為 15 秒（`vite.config.ts`）。
- 外部 AI 整檔輸出會刪註解、自編文案、被截斷；驗收要先還原註解、對照 A 原始碼核文字與 class，再搬回主目錄。
- 歷史紀錄一律以瀏覽器歷史為準：`src/core/overlay-back.ts`（彈窗返回）、`src/core/back-guard.ts`（返回起點、LINE／PWA 首頁哨兵），不要另建站內堆疊。
- 自訂角色使用者暫時看不到私密活動列表（V 階段保守做法，P 階段補）。

## 11. 下一位 PM 第一天要做的五件事

1. 讀 FC 的 `CLAUDE.md`、本檔、FC 的 local-only `docs/specs/lite-convergence/handover-private.md`（帳號、平台、待站長授權清單），跑 `npm run check` 確認全綠。
2. 查用量（`get_usage`），照站長規則：產出交給 DeepSeek／MiMo、Codex 最高驗收，自己只做決策與合併。
3. 問站長 M-171：是否讓 Google 收錄 next.toosterx.com（目前 noindex，見 4.1）。
4. 開工第 3 批（活動詳情與報名）：用 FC scratchpad 的 `build-batch-ctx.mjs` 依盤點項目產生附件，派工單照 `p77-batch2/prompt-common.md` 格式，每單拆小避免截斷。
5. 每段工作結束更新施工看板（ArtifactData，只改資料不重發頁面），並在 FC `docs/claude-memory.md` 追加紀錄。

## 12. 進度

公開看板：https://claude.ai/artifact/Dqg9nbiqqZaRAjt6fpCnss（籌劃中 → 施工中 → 測試中 → 已完成）。
