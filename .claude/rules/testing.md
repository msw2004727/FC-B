---
paths:
  - "src/**"
  - "scripts/**"
  - "vite.config.ts"
  - "package.json"
  - ".github/workflows/**"
---

# 測試與驗證

> 2026-11-15 新增：把交付前要跑什麼、怎麼判讀寫成一處。測試寫法的避坑條文（L-27、L-29、L-30、L-42 等）正本在 `review-lessons.md`。

## 1. 指令

| 目的 | 指令 |
| --- | --- |
| 只跑一個或幾個測試檔 | `npx vitest run <路徑> [<路徑>…]` |
| 只跑名稱符合的測試 | `npx vitest run <路徑> -t "<名稱片段>"` |
| 型別 | `npm run typecheck` |
| 語系鍵一致 | `npm run check:i18n` |
| 型別＋全套測試＋語系 | `npm run check` |
| 打包 | `npm run build`（或只打包 `npx vite build`） |
| 首頁大小預算（要先打包） | `npm run check:bundle` |
| 規則副本 | `npm run check:rules-sync` |
| 規則測試（會啟動 emulator） | `npm run test:rules` |
| 權限三邊對照 | `node scripts/check-permission-parity.mjs <FC 工作樹路徑>`（見 `data-permissions.md`） |
| 打包檔名穩定性（動 `vite.config.ts` 時） | `npx vitest run scripts/asset-filename-stability.test.mjs` |
| 截圖 | `npm run e2e:shots` |

- 測試檔放在被測檔旁邊，命名 `*.test.ts`／`*.test.tsx`；`scripts/` 下的是 `*.test.mjs`。要進 emulator 的規則測試命名 `*.rules.test.*`。
- 施工中只跑相關檔。全套測試耗時長，由 PM 在專用測試機跑；施工者不要在使用者正在操作的機器上跑全套。
- 環境：Node 24（CI 與開發機一致）；`test:rules` 需要 Java 21；`check:bundle` 要先打包。

## 2. 判讀結果

- 看通過數之外，還要核對**測試檔總數**與輸出裡有沒有 `Errors` 行：worker 記憶體不足時，整個檔會消失而不是列成失敗，通過數看起來仍是全綠。
- 多個工作樹共用同一份快取時，以 glob 載入的模組（例如語系檔）可能互相污染；結果怪異時加 `--no-fsModuleCache` 重跑再判斷。
- 測試失敗先分清是這次改動、環境問題還是偶發，再決定修哪裡；不得為了變綠而刪測試、放寬斷言或加跳過。
- 本機全過不等於可上線：CI 另外跑多時區測試、大小預算與規則測試。反過來，CI 也不是全部：完整 CI 只在推 `main`、開 PR 或手動觸發時跑；其他分支只跑型別與語系；只改 Markdown、`docs/`、`.claude/` 不觸發；權限三邊對照不在 CI；「規則副本對正本」只警示不擋。
- 規則測試在一般測試裡會整組跳過，要另外跑 `npm run test:rules` 才算有驗。

## 3. 改了什麼至少要補什麼

- 修 bug：先寫一個會失敗的測試重現它，再修。
- 非同步流程：用可控制完成順序的 Promise 測「後發先到」與「第一次失敗、第二次成功」（L-29、L-30）。
- 登入者相關畫面：要有「uid 延後才出現」一案（L-43）。
- 換行、省略、版面：用真實瀏覽器截圖驗證，不能只靠 DOM 斷言（L-27）。
- 直接寫 Firestore：規則測試「應放行／應拒絕」兩邊（見 `data-permissions.md`）。
- 高風險改動（更新流程、資料寫入）：驗收時把接線拿掉一次，確認測試真的會紅。
- 效能宣稱與分塊改動：用正式打包產物的數字佐證，不以載入函式的呼叫次數代替請求數（L-41）。
