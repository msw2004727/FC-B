// Cloudflare Pages 進階模式 worker：只處理分享預覽（OG）代理，其餘請求不進 worker
// （由 `_routes.json` 的 include 限縮，避免每個請求都計 Worker 次數；`/og.png` 改放實體檔，不經 worker）。
// 照 A `_worker.js` 的 `/event-share`、`/team-share` 行為移植（換站計畫書 F-02，換站前必修）。
const TEAM_SHARE_PATH = "/team-share";
const EVENT_SHARE_PATH = "/event-share";
const OG_FUNCTION_ORIGIN = "https://asia-east1-fc-football-6c8dc.cloudfunctions.net";
const TEAM_SHARE_OG_PATH = "/teamShareOg";
const EVENT_SHARE_OG_PATH = "/eventShareOg";
const EDGE_CACHE_TTL = 300; // 5 minutes
// 與 Functions `OG_CRAWLER_USER_AGENT_RE` 相同：上游對爬蟲回無跳轉版、對真人回跳轉版，快取鍵必須分開，
// 否則先被爬蟲抓過的連結，5 分鐘內真人點開會停在沒有跳轉的頁面（A 同樣問題，見審查 P2）。
const OG_CRAWLER_USER_AGENT_RE = /(facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|pinterest|skypeuripreview|linespider|googlebot|google-inspectiontool|applebot|embedly|quora link preview|outbrain|vkshare|tumblr|threads)/i;

function isSharePath(pathname, base) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function buildOgUrl(requestUrl, sharePath, functionPath) {
  const incoming = new URL(requestUrl);
  const target = new URL(OG_FUNCTION_ORIGIN);
  target.pathname = `${functionPath}${incoming.pathname.slice(sharePath.length)}`;
  target.search = incoming.search;
  return target;
}

function methodNotAllowed() {
  return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, HEAD" } });
}

function buildCacheKey(request) {
  const key = new URL(request.url);
  key.searchParams.set("__ogbot", OG_CRAWLER_USER_AGENT_RE.test(request.headers.get("user-agent") || "") ? "1" : "0");
  return new Request(key.toString(), { method: "GET" });
}

async function handleOgShare(request, ctx, sharePath, functionPath) {
  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed();

  const cache = caches.default;
  const cacheKey = buildCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(buildOgUrl(request.url, sharePath, functionPath).toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });

  if (upstream.ok) {
    const response = new Response(upstream.body, upstream);
    response.headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_TTL}, s-maxage=${EDGE_CACHE_TTL}`);
    if (request.method === "GET") ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  return new Response(upstream.body, upstream);
}

// ── 1b 實機驗證開關（只存在 staging 演練 commit，顧問 §3.271／§3.276；不得進 main）──
// 只在 next.toosterx.com 生效：
//   /?fcb_drill=reset   回一頁小頁面：解除離線快取（SW）、清快取與演練 cookie（測試前先開）
//   /events/<id>?fcb_drill=503   啟動（第一輪，關離線快取）：對活動詳情頁 chunk 的「第一次」請求回 503，之後一律放行
//   /events/<id>?fcb_drill=503sw 啟動（第二輪，選做，不關離線快取）：同上，但不改 swEnabled
//   /?fcb_drill=status  顯示是否已啟動、503 是否真的打到（時間）、目前是否有離線快取控制頁面
// 啟動期間，這個瀏覽器拿到的 runtime-config 的 swEnabled 改為 false，避免離線快取直接供應程式檔、讓 503 打不到（測試假性顯示「不帶毒」）。
const DRILL_HOST = "next.toosterx.com";
const DRILL_CHUNK_RE = /^\/assets\/EventDetailPage-[^/]+\.js$/;
const DRILL_COOKIE_MAX_AGE = 900;
const DRILL_COOKIE_ATTRS = `Path=/; Max-Age=${DRILL_COOKIE_MAX_AGE}; Secure; SameSite=Lax`;
const DRILL_CLEAR_ATTRS = "Path=/; Max-Age=0; Secure; SameSite=Lax";

function drillCookie(cookie, name) {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function drillPage(title, body, script) {
  return new Response(
    `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>` +
      `<style>body{font:18px/1.6 -apple-system,sans-serif;padding:20px;max-width:560px;margin:auto}b{font-size:22px}</style></head>` +
      `<body><h1>${title}</h1>${body}<pre id="sw">檢查中…</pre><script>${script}</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

const DRILL_SW_SCRIPT = `(async()=>{const el=document.getElementById('sw');try{const c=!!(navigator.serviceWorker&&navigator.serviceWorker.controller);const rs=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];el.textContent='離線快取控制此頁：'+(c?'是':'否')+'；已註冊：'+rs.length;}catch(e){el.textContent='離線快取：無法檢查';}})();`;
const DRILL_RESET_SCRIPT = `(async()=>{const el=document.getElementById('sw');try{const rs=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];await Promise.all(rs.map(r=>r.unregister()));if(window.caches){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));}try{sessionStorage.clear();}catch(e){}try{localStorage.removeItem('fcb_drill_timing');}catch(e){}el.textContent='已解除離線快取 '+rs.length+' 個、清除快取完成。可以進行下一步。';}catch(e){el.textContent='清除時發生問題：'+e;}})();`;

// 甲案修正版演練（顧問 §3.323 P3）：只在演練啟動時注入詳情頁 HTML 的 <head> 最前面，記下 vite:preloadError 與失敗 link error 的時間（ms，頁面開始起算），
// 存 localStorage（跨分頁可讀），狀態頁顯示最近 4 次頁面的紀錄；用來讀回 iPhone 實機的「preloadError → link error」時間差。只在演練開關內，不進上線樹。
const DRILL_TIMING_SCRIPT = `<script>(function(){var t0=performance.now(),K='fcb_drill_timing',all=[];try{all=JSON.parse(localStorage.getItem(K)||'[]')}catch(e){}var rec={at:new Date().toISOString(),ua:navigator.userAgent.slice(0,80),sw:!!(navigator.serviceWorker&&navigator.serviceWorker.controller),ev:[]};all.push(rec);all=all.slice(-4);function save(){try{localStorage.setItem(K,JSON.stringify(all))}catch(e){}}function ms(){return Math.round(performance.now()-t0)}addEventListener('vite:preloadError',function(){rec.ev.push(['preloadError',ms()]);save()},true);document.addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='LINK'){rec.ev.push(['link-error '+t.rel+' '+String(t.href||'').split('/assets/')[1],ms()]);save()}},true);addEventListener('pagehide',function(){rec.ev.push(['pagehide',ms()]);save()});save()})();</script>`;
const DRILL_TIMING_VIEW = `(function(){var el=document.getElementById('timing');try{var all=JSON.parse(localStorage.getItem('fcb_drill_timing')||'[]');if(!all.length){el.textContent='時間紀錄：無';return;}el.textContent=all.map(function(r,i){return '#'+(i+1)+' '+r.at+' 離線快取控制：'+(r.sw?'是':'否')+'\\n  '+r.ev.map(function(e){return e[0]+' @'+e[1]+'ms'}).join('\\n  ')}).join('\\n');}catch(e){el.textContent='時間紀錄：無法讀取';}})();`;

async function drillHtml(request, env) {
  const page = await env.ASSETS.fetch(request);
  const html = (await page.text()).replace("<head>", "<head>" + DRILL_TIMING_SCRIPT);
  const res = new Response(html, page);
  res.headers.delete("Content-Length");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function drillGate(request, env, url) {
  if (url.hostname !== DRILL_HOST) return null;
  const cookie = request.headers.get("cookie") || "";
  const mode = url.searchParams.get("fcb_drill");
  const armMode = drillCookie(cookie, "fcb_drill");
  const armed = armMode === "armed" || armMode === "armed-sw";
  const hitAt = drillCookie(cookie, "fcb_drill_hit");
  if (mode === "reset") {
    const res = drillPage("演練重置", "<p><b>已重置</b></p>", DRILL_RESET_SCRIPT);
    res.headers.append("Set-Cookie", `fcb_drill=; ${DRILL_CLEAR_ATTRS}`);
    res.headers.append("Set-Cookie", `fcb_drill_hit=; ${DRILL_CLEAR_ATTRS}`);
    return res;
  }
  if (mode === "status") {
    const hitText = hitAt ? `是（${hitAt}）` : "否";
    return drillPage(
      "演練狀態",
      `<p>已啟動：<b>${armed ? (armMode === "armed-sw" ? "是（第二輪，不關離線快取）" : "是（第一輪，關離線快取）") : "否"}</b></p><p>503 已打到：<b>${hitText}</b></p><pre id="timing">時間紀錄：讀取中…</pre>`,
      DRILL_SW_SCRIPT + DRILL_TIMING_VIEW,
    );
  }
  if ((mode === "503" || mode === "503sw") && url.pathname.startsWith("/events/") && !armed) {
    const res = await drillHtml(request, env);
    res.headers.append("Set-Cookie", `fcb_drill=${mode === "503sw" ? "armed-sw" : "armed"}; ${DRILL_COOKIE_ATTRS}`);
    return res;
  }
  // 啟動後的詳情頁（含自動重整那一次）也注入時間紀錄。
  if (armed && url.pathname.startsWith("/events/") && (request.headers.get("accept") || "").includes("text/html")) {
    return drillHtml(request, env);
  }
  // 只改回應、不寫檔（顧問 §3.276 條件）；第二輪（armed-sw）不改。
  if (url.pathname === "/runtime-config.json" && armMode === "armed") {
    const original = await env.ASSETS.fetch(request);
    const config = await original.json();
    config.swEnabled = false;
    return new Response(JSON.stringify(config), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (DRILL_CHUNK_RE.test(url.pathname) && armed && !hitAt) {
    const at = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    return new Response("drill 503", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": `fcb_drill_hit=${encodeURIComponent(at)}; ${DRILL_COOKIE_ATTRS}`,
      },
    });
  }
  // 實機驗證專用 commit（顧問 §3.285／§3.286）：詳情 chunk 的正常回應「邊緣不快取、瀏覽器照常快取」，
  // 避免被邊緣快取後 worker 不再執行、503 打不到；瀏覽器端行為維持和正式站一樣可長期快取。
  if (DRILL_CHUNK_RE.test(url.pathname)) {
    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    res.headers.set("Cache-Control", "private, max-age=31536000, immutable");
    res.headers.set("CDN-Cache-Control", "no-store");
    return res;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const drilled = await drillGate(request, env, new URL(request.url));
    if (drilled) return drilled;
    if (isSharePath(pathname, TEAM_SHARE_PATH)) return handleOgShare(request, ctx, TEAM_SHARE_PATH, TEAM_SHARE_OG_PATH);
    if (isSharePath(pathname, EVENT_SHARE_PATH)) return handleOgShare(request, ctx, EVENT_SHARE_PATH, EVENT_SHARE_OG_PATH);
    return env.ASSETS.fetch(request);
  },
};
