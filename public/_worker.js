// Cloudflare Pages 進階模式 worker：只處理分享預覽（OG）代理與舊 OG 圖路徑，其餘請求不進 worker
// （由 `_routes.json` 的 include 限縮，避免每個請求都計 Worker 次數）。
// 照 A `_worker.js` 的 `/event-share`、`/team-share`、`/og.png` 行為移植（換站計畫書 F-02，換站前必修）。
const TEAM_SHARE_PATH = "/team-share";
const EVENT_SHARE_PATH = "/event-share";
const LEGACY_OG_IMAGE_PATH = "/og.png";
const DEFAULT_OG_IMAGE_PATH = "/assets/og/default.png";
const OG_FUNCTION_ORIGIN = "https://asia-east1-fc-football-6c8dc.cloudfunctions.net";
const TEAM_SHARE_OG_PATH = "/teamShareOg";
const EVENT_SHARE_OG_PATH = "/eventShareOg";
const EDGE_CACHE_TTL = 300; // 5 minutes

function isSharePath(pathname, base) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function stripTrailingSlash(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
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

async function handleOgShare(request, sharePath, functionPath) {
  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed();

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
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
    request.method === "GET" && cache.put(cacheKey, response.clone());
    return response;
  }
  return new Response(upstream.body, upstream);
}

async function handleLegacyOgImage(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed();
  const target = new URL(request.url);
  target.pathname = DEFAULT_OG_IMAGE_PATH;
  target.search = "";
  const upstream = await env.ASSETS.fetch(new Request(target.toString(), {
    method: request.method,
    headers: request.headers,
  }));
  const response = new Response(upstream.body, upstream);
  response.headers.set("Cache-Control", "public, max-age=86400");
  return response;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (stripTrailingSlash(pathname) === LEGACY_OG_IMAGE_PATH) return handleLegacyOgImage(request, env);
    if (isSharePath(pathname, TEAM_SHARE_PATH)) return handleOgShare(request, TEAM_SHARE_PATH, TEAM_SHARE_OG_PATH);
    if (isSharePath(pathname, EVENT_SHARE_PATH)) return handleOgShare(request, EVENT_SHARE_PATH, EVENT_SHARE_OG_PATH);
    return env.ASSETS.fetch(request);
  },
};
