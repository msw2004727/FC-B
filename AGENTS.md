# AGENTS.md — 給非 Claude Code 的 AI

本 repo 的規則只有一套，正本是 `CLAUDE.md` 與 `.claude/rules/*.md`。這份檔案只負責指路，不另外定義規則。

1. 開工前完整讀 `CLAUDE.md`。
2. 依 `CLAUDE.md`「改哪裡讀哪份」那張表，讀要改的範圍對應的規則檔；涉及多個範圍就全部讀。規則檔開頭的 `paths` 是它適用的檔案範圍。
   - `.claude/rules/ui.md`：畫面、樣式、文案、語系檔
   - `.claude/rules/data-permissions.md`：資料讀寫、權限、`emulator/`
   - `.claude/rules/testing.md`：測試與驗證指令、結果判讀
   - `.claude/rules/review-lessons.md`：過去審查抓到的坑（L-01 起）
   - `.claude/rules/release-update.md`：版號、更新流程、強制更新
3. 工作單（派工卡）的要求與規則衝突時，停下來回報，不自行取捨。
4. 交付時附上實際跑過的指令與輸出；沒跑的項目明說沒跑。
5. 審查別人的交件時只讀不改，結論寫 GO／GO with fixes／NO-GO，問題分 P1～P3 並附檔案與行號。
