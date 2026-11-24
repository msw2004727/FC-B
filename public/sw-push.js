// 網頁推播接收（W4）：由 vite.config.ts 的 workbox.importScripts 匯入新站 SW，排在 sw-legacy-compat.js 之後。
// 只做兩件事：push 顯示通知、notificationclick 開站內頁。不 importScripts、不 fetch、不讀寫快取。
// 頂層與每個監聽都包 try/catch：這支檔頂層丟錯會讓 sw.js 後面的 workbox 設定整段不執行（設計書 §2.4）。
// 推播內容只有 v、title、body、url（FC functions/web-push-validate.js 的 buildPushPayload）；長度上限與伺服器相同。
(function () {
  var TITLE_MAX = 80;
  var BODY_MAX = 180;
  var APP_NAME = 'ToosterX';
  var DEFAULT_PATH = '/';
  var ICON = '/assets/icons/icon-192x192.png';

  function cut(value, max) {
    var chars = Array.from(value);
    return chars.length > max ? chars.slice(0, max).join('') : value;
  }

  // 只收站內相對路徑：單一 / 開頭、不是 //、沒有反斜線與控制字元，解析後仍是同源。其他一律回預設路徑。
  // 正規化會消掉 . 與 ..（/..//evil.com 會變成 //evil.com），所以組出結果後再檢查一次。
  function badPath(value) {
    return value.charAt(0) !== '/' || value.charAt(1) === '/' || /[\\\u0000-\u001f\u007f]/.test(value);
  }

  function safePath(value) {
    try {
      if (typeof value !== 'string' || value.length > 512 || badPath(value)) return DEFAULT_PATH;
      var origin = self.location.origin;
      var url = new URL(value, origin);
      if (url.origin !== origin) return DEFAULT_PATH;
      var out = url.pathname + url.search + url.hash;
      return out.length > 512 || badPath(out) ? DEFAULT_PATH : out;
    } catch (e) {
      return DEFAULT_PATH;
    }
  }

  // 壞內容不丟錯：回 null，呼叫端改顯示只有站名的通知（每則推播都必須顯示通知，否則瀏覽器會撤銷訂閱）。
  function readPayload(data) {
    try {
      if (!data) return null;
      var p = JSON.parse(data.text());
      if (!p || p.v !== 1) return null;
      if (typeof p.title !== 'string' || typeof p.body !== 'string' || typeof p.url !== 'string') return null;
      return { title: cut(p.title, TITLE_MAX), body: cut(p.body, BODY_MAX), url: safePath(p.url) };
    } catch (e) {
      return null;
    }
  }

  function show(payload) {
    var p = payload || { title: '', body: '', url: DEFAULT_PATH };
    var options = { body: p.body, icon: ICON, data: { url: p.url } };
    return self.registration.showNotification(p.title || APP_NAME, options).catch(function () {
      return self.registration.showNotification(APP_NAME, { data: { url: DEFAULT_PATH } });
    }).catch(function () {});
  }

  function onPush(event) {
    try {
      event.waitUntil(show(readPayload(event.data)));
    } catch (e) {
      /* waitUntil 不可用：略過 */
    }
  }

  function pickClient(list, href) {
    var origin = self.location.origin;
    var same = [];
    for (var i = 0; i < list.length; i++) {
      try {
        if (new URL(list[i].url).origin === origin) same.push(list[i]);
      } catch (e) { /* 略過 */ }
    }
    for (var j = 0; j < same.length; j++) if (same[j].url === href) return { client: same[j], exact: true };
    for (var k = 0; k < same.length; k++) if (same[k].focused || same[k].visibilityState === 'visible') return { client: same[k], exact: false };
    return same.length ? { client: same[0], exact: false } : null;
  }

  function open(href) {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var hit = pickClient(list, href);
      if (!hit) return self.clients.openWindow(href);
      return hit.client.focus().then(function (client) {
        if (hit.exact) return client;
        return (client || hit.client).navigate(href);
      }).catch(function () {
        return self.clients.openWindow(href);
      });
    }).catch(function () {});
  }

  function onClick(event) {
    try {
      event.notification.close();
      var data = event.notification.data;
      var href = new URL(safePath(data && data.url), self.location.origin).href;
      event.waitUntil(open(href));
    } catch (e) {
      /* 通知資料壞掉：不開頁 */
    }
  }

  try {
    self.addEventListener('push', onPush);
    self.addEventListener('notificationclick', onClick);
  } catch (e) {
    /* 不支援推播的環境：略過 */
  }
})();
