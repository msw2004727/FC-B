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
- Cloudflare Pages 專案、DNS、Firestore 複合索引（若 B 有新查詢）。

## 8. 進度

公開看板：https://claude.ai/artifact/Dqg9nbiqqZaRAjt6fpCnss（籌劃中 → 施工中 → 測試中 → 已完成）。
