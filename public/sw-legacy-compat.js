// 換站相容層（舊站 A → 新站 B）：由 vite.config.ts 的 workbox.importScripts 匯入新站 SW。
// 舊站 A 還開著（或被 Safari 還原）的頁面，在新站 SW 接管後會用 MessageChannel 問控制中的 SW
// 「SPORTHUB_GET_VERSION」，等不到 SPORTHUB_VERSION 回覆就一直停在「更新尚未完成，點我重試載入最新版」。
// 這裡回一個「比舊站最後版本新」的版號，舊頁面就會判定可以重載，重載後走新站。
// 版號格式必須符合舊站的 /^0\.\d{8}[a-z]*$/，且字串比較大於舊站 V（0.20261030a）；固定值即可，不隨新站版號變動。
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SPORTHUB_GET_VERSION') return;
  const port = event.ports && event.ports[0];
  if (port) port.postMessage({ type: 'SPORTHUB_VERSION', version: '0.20261111z' });
});
