# FC-B 交接文件

> 最後更新：2026-10-19。這份是**公開版**，只放本來就公開或不具風險的資訊。秘密（密碼、token、金鑰）一律不寫；需要的人向站長索取權限，不要把值貼進 repo。

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
| B 部署平台 | Cloudflare Pages（規劃） | 從本 repo 自動建置；專案與 DNS 尚未建立 |
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
| `VITE_PUBLIC_LAUNCH` | **不設＝內測模式**（正式建置預設）；只有正式上線才設 `1` |
| `VITE_INTERNAL_TEST_UID_HASHES` | 內測白名單：每位內測者 LINE UID 的 SHA-256（十六進位，逗號分隔）。不放明文 UID；空白＝沒有人能進 |
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

正式建置在 `VITE_PUBLIC_LAUNCH` 不是 `1` 時自動進入內測模式（忘了設也不會對外開放）。程式：`src/data/internal-test.ts`、`vite.config.ts` 的 `internalTestNoIndex`。

- **白名單閘門**：登入後比對 SHA-256(uid)，不在名單（含未登入）只看到「內測中」頁，不載入任何功能。這是**資料污染防護與體驗閘門，不是安全邊界**；權限仍由 Firestore Rules 與 Callable 把關，與舊版相同。
- **搜尋引擎隔離**：建置時注入 `noindex` meta，輸出 `robots.txt`（全站 Disallow）與 Cloudflare `_headers`（`X-Robots-Tag`、HTML `no-store`、`/assets/*` 長快取）。不提交 sitemap。
- **寫入限制**：活動相關寫入（報名、取消、簽到、建立、編輯、名額）只限標題以「[內測]」開頭的活動；建立 [內測] 活動時，有加值權限就自動設為私密（舊版公開列表看不到），沒有則回傳 `visibleInLegacyList` 讓 UI 提示。俱樂部、私訊、收件匣投遞、LINE 通知：目標名稱以「[內測]」開頭或影響到的所有人都在白名單才放行；收件匣與 LINE 通知一律要求收件人在白名單，所以真實使用者不會收到任何內測產生的通知。只動自己的資料（個人資料、身分設定、自己收件匣已讀／刪除）不擋。
- **版本角標**：畫面左上角顯示「內測版 · 短 commit」（Cloudflare 建置用 `CF_PAGES_COMMIT_SHA`）。
- **計算白名單雜湊**（只在自己的電腦算，不要把 UID 貼到任何網站）：

  ```bash
  node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <LINE UID>
  ```

- **測試資料**：測試用活動與俱樂部由站長在舊版建立，名稱以「[內測]」開頭，俱樂部幹部設為內測帳號；大部分操作請用測試帳號，不要用主帳號。

### 正式上線收尾清單

1. Cloudflare Pages 設 `VITE_PUBLIC_LAUNCH=1`、移除 `VITE_INTERNAL_TEST_UID_HASHES`，重新建置。
2. 確認建置輸出沒有 `robots.txt` 的全站 Disallow、`_headers` 與 noindex meta，畫面沒有「內測版」角標（`src/data/internal-test.test.ts`、`src/app/App.internal-test.test.tsx` 已有單元測試；建置輸出要再人工看一次）。
3. 站長在舊版刪除所有 [內測] 活動與測試俱樂部（待做：B 提供唯讀清單頁列出「標題含 [內測] 且由白名單帳號建立」的文件）。
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

## 7. 尚未完成、上線前要做的事

- 後台完整權限（P 階段）→ 收件匣的入隊核准按鈕要等它。
- 建立與編輯活動、活動管理、教育課程、通知、個人儀表板、後台功能。
- FC 待部署的 Cloud Functions（一次部署，需站長授權）：資料同步密碼改用 Secret Manager（Secret 名稱 `DATA_SYNC_SETTINGS_PASSWORD`，部署前須先建立）、`adjustEventCapacity`、名單確認出席、俱樂部人數重算。
- Cloudflare Pages 專案、DNS、Firestore 複合索引（若 B 有新查詢）。內測部署前三道防護已完成（見 4.1）；建專案、設 DNS、推送都要站長逐項授權。

## 8. 進度

公開看板：https://claude.ai/artifact/Dqg9nbiqqZaRAjt6fpCnss（籌劃中 → 施工中 → 測試中 → 已完成）。
