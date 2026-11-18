# AGENTS.md — 給非 Claude Code 的 AI

本 repo 的規則正本是 `CLAUDE.md` 與 `.claude/rules/*.md`。這份檔案負責指路，並重述幾條外部 AI 最容易漏的守則（內容都出自 `CLAUDE.md`，兩邊不一致時以 `CLAUDE.md` 為準）。

## 先讀什麼

1. 開工前完整讀 `CLAUDE.md`。
2. 依 `CLAUDE.md`「改哪裡讀哪份」那張表，讀要改的範圍對應的規則檔；涉及多個範圍就全部讀。規則檔開頭的 `paths` 是它適用的檔案範圍。
   - `.claude/rules/ui.md`：畫面、樣式、文案、語系檔
   - `.claude/rules/data-permissions.md`：資料讀寫、權限、`emulator/`
   - `.claude/rules/testing.md`：測試與驗證指令、結果判讀
   - `.claude/rules/review-lessons.md`：過去審查抓到的坑（L-01 起）
   - `.claude/rules/release-update.md`：版號、更新流程、強制更新
3. 規則引用另一個 repo（FC）的條文而讀不到時，回報，不要猜。

## 不可以做的事

- 不得 push、不得部署、不得改 `public/runtime-config.json`。是否 commit 照派工卡；卡上沒寫就不 commit。
- 不改派工卡沒列的檔；交件位置照派工卡。
- 不讀、不輸出 `.env`；不把真實的 UID、email、token 寫進程式、測試資料或報告。
- 不在使用者正在操作的機器上跑全套測試；只跑相關測試檔、型別與語系檢查。
- 不自行選定版面或樣式；實作與核可的預覽有任何不同，列出來回報。
- 派工卡的要求與規則衝突時，停下來回報，不自行取捨。

## 交件

- 附上實際跑過的指令與輸出；沒跑的項目明說沒跑。
- 檔案一律 UTF-8 無 BOM、行尾 LF；不得混入零寬字元。
- 這是公開 repo：commit 訊息、註解與文件用中性描述，安全相關的修正不寫出弱點細節。
- 審查別人的交件時只讀不改，結論寫 GO／GO with fixes／NO-GO，問題分 P1～P3 並附檔案與行號。
