---
paths:
  - "src/data/**"
  - "src/features/**/data/**"
  - "emulator/**"
  - "scripts/sync-rules.mjs"
  - "scripts/check-rules-sync.mjs"
  - "scripts/check-permission-parity.mjs"
---

# 資料、權限與規則副本

> 2026-11-15 新增：把原本 `CLAUDE.md` 只有一行的資料契約展開，並收進散在交接與審查紀錄裡的做法。避坑細則 L-31～L-39、L-43 的正本在 `review-lessons.md`，這裡只指過去、不重寫。

## 1. 後端在別的 repo

- Firestore Rules、Storage Rules、Cloud Functions、索引的正本都在 FC repo。本 repo 不部署後端，也不在這裡改後端行為。
- 需要後端配合的改動（新 Callable、放寬或收緊規則、新索引）：在這裡只寫前端，並明確列出「需要 FC 那邊先做什麼」；後端沒上線前，前端不得假設它已存在。
- 新站與舊站共用同一份正式資料。任何寫入格式的改動都要確認舊站讀得懂，不改變與舊站共用的儲存格式（L-31）。

## 2. 寫入方式

- 有 Callable 的動作一律走 Callable（清單在 `src/data/contract/callables.ts` 與 `src/data/callables.ts`）；不實作舊站的直寫 fallback，不移植舊站的鎖定邏輯。
- 沒有既有通道的業務動作標為「不支援」，不得用直寫補（L-35）；只有後端會寫的集合（例如經驗值日誌）前端不得直寫（L-34）。
- 允許直寫的動作：payload 逐動作列欄位白名單，不得把整份讀到的文件寫回（L-32）；`serverTimestamp()` 只用在該動作列出的欄位（L-33）；一定要有 Rules emulator 測試，「應放行」與「應拒絕」兩邊都要有。
- 身分欄位依動作分別取操作者、所屬者、建立者，不得一律取目前登入者（L-36）。頁面取登入者一律用 `useViewer()`（L-43）。
- 路徑常數用 `src/data/paths.ts`，ID 處理用 `src/data/ids.ts`；重試用的請求編號不得當成正式 ID（L-39）。
- 讀得到不等於可以顯示：可見性過濾與實際權限要同時進查詢與畫面判斷（L-38）。

## 3. 規則副本（`emulator/`）

- `emulator/firestore.rules`、`emulator/storage.rules` 是 FC 正本的位元組副本，**不得手改**。更新用 `npm run sync:rules -- <FC repo 路徑>`，它會同時更新 `emulator/RULES_SOURCE.json` 的雜湊與來源。
- `npm run check:rules-sync` 驗副本與紀錄的雜湊一致；CI 另外會拿副本對 FC 正本比對。
- `npm run test:rules` 會啟動 Firestore emulator，只跑檔名含 `.rules.test.` 的測試。新增直寫動作時，測試檔照這個命名才會被跑到。
- 正本規則的運算式數量接近上限；這裡的測試過了不代表正本改得動，規則本身的修改一律回 FC 處理。

## 4. 權限對照

- 角色固有權限 `INHERENT_ROLE_PERMISSIONS` 在 `src/features/profile/data/permissions.ts`，必須與舊站前端、Functions 三邊一致。改這個常數就要跑 `npm run check:parity`（需要旁邊有 FC repo），而且三邊要同一批改。
- 自訂角色的層級由後端資料決定，不要用讀程式碼的方式猜舊站行為；要對照就用既有的 oracle 測試（`*.oracle.test.ts`）。

## 5. 環境與正式資料

- `vite build` 的產物會連正式環境。要用打包後的頁面讀寫資料前，先實測連線目標；本機開發與測試用 emulator（`.env.example` 的 `VITE_FIREBASE_EMULATOR`、`npm run emulators`、`npm run seed:emulator`）。
- 不得拿正式環境的寫入當測試。需要正式環境驗證時另外取得同意，用最小、可清理的資料。
- 診斷紀錄、測試資料與文件不放真實的 UID、email、token；secret 一律不進 repo。

## 6. 之後要接線上支付

- 報名、取消、遞補、費用、退款狀態、通知這幾處改動時留接點（狀態欄位與流程分段不要寫死成「免費即完成」），但不先實作金流。
- 每張相關的工作單寫一行「支付預留：有／無／不適用＋做法」。
