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

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (isSharePath(pathname, TEAM_SHARE_PATH)) return handleOgShare(request, ctx, TEAM_SHARE_PATH, TEAM_SHARE_OG_PATH);
    if (isSharePath(pathname, EVENT_SHARE_PATH)) return handleOgShare(request, ctx, EVENT_SHARE_PATH, EVENT_SHARE_OG_PATH);
    return env.ASSETS.fetch(request);
  },
};
