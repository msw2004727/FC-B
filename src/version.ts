// 新版 B 的版號，規則與舊版 A 相同（A CLAUDE.md R-REL-001／R-REL-002）：
//   格式 0.YYYYMMDD{suffix}（台北日期）；當日第一次上線無後綴，同日再上線依 a…z、za… 遞增，跨日重置。
//   只用 `node scripts/bump-version.mjs` 更新（每個上線批次推送前執行一次），不要手改。
// 顯示位置與 A 相同：側邊選單最下方「下載APP」下方的 #home-version-tag（文字 `v{版號}`）。
export const APP_VERSION = '0.20261030a';
