export interface EventSocialPlatform {
  key: string;
  label: string;
  host: string;
  icon: string;
}

export interface EventSocialLink {
  url: string;
  platform: string;
  label: string;
  host: string;
}

const EVENT_SOCIAL_LINKS_MAX = 5;

// 照 A event-create-options.js#_detectEventSocialPlatform 的比對順序、網域、label、icon（PM 依 A 原檔補齊）。
const PLATFORMS: ReadonlyArray<{ key: string; label: string; hosts: readonly string[]; icon: string }> = [
  { key: 'line', label: 'LINE', hosts: ['line.me', 'lin.ee'], icon: 'LINE' },
  { key: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'messenger.com', 'm.me'], icon: 'f' },
  { key: 'instagram', label: 'Instagram', hosts: ['instagram.com'], icon: 'IG' },
  { key: 'threads', label: 'Threads', hosts: ['threads.net', 'threads.com'], icon: '@' },
  { key: 'x', label: 'X', hosts: ['x.com', 'twitter.com'], icon: 'X' },
  { key: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], icon: '▶' },
  { key: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'], icon: '♪' },
  { key: 'discord', label: 'Discord', hosts: ['discord.gg', 'discord.com'], icon: 'D' },
  { key: 'telegram', label: 'Telegram', hosts: ['telegram.org', 'telegram.me', 't.me'], icon: '✈' },
  { key: 'linktree', label: 'Linktree', hosts: ['linktr.ee', 'linktree.com'], icon: 'LT' },
];

// 照 A 同檔圖示；B 從根路徑取（詳情頁網址是 /events/:id，相對路徑會 404），圖檔由 A img/ 複製到 public/img。
const IMAGE_ICONS: Readonly<Record<string, string>> = {
  instagram: '/img/Instagram-Logo--Streamline-Plump-Gradient.png',
  threads: '/img/Thread-Block-Logo--Streamline-Ultimate.png',
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

// 照 A _normalizeEventSocialUrl：沒有 scheme 補 https://，只收 http(s)，去掉 hash。
export function normalizeEventSocialUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // B 改良（安全）：A 會接受含控制字元、反斜線或帳密的網址；這些在 href 有釣魚風險，B 一律不顯示。
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

// 照 A _detectEventSocialPlatform：host 去掉 www.，未知平台 label 用 host。
export function detectEventSocialPlatform(value: string): EventSocialPlatform {
  const normalized = normalizeEventSocialUrl(value);
  let host = '';
  try {
    host = normalized ? new URL(normalized).hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  const platform = PLATFORMS.find(item =>
    item.hosts.some(domain => host === domain || host.endsWith(`.${domain}`)));
  return platform
    ? { key: platform.key, label: platform.label, host, icon: platform.icon }
    : { key: 'link', label: host || '連結', host, icon: '↗' };
}

// 照 A _normalizeEventSocialLinks。
export function normalizeEventSocialLinks(value: unknown): EventSocialLink[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: EventSocialLink[] = [];
  list.forEach(item => {
    const object = record(item);
    const rawUrl = typeof item === 'string'
      ? item
      : object?.url || object?.href || object?.link || '';
    const url = normalizeEventSocialUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const meta = detectEventSocialPlatform(url);
    const rawLabel = object ? String(object.label || '').trim() : '';
    normalized.push({
      url,
      platform: meta.key,
      label: rawLabel || meta.label,
      host: meta.host || '',
    });
  });
  return normalized.slice(0, EVENT_SOCIAL_LINKS_MAX);
}

// 照 A _renderEventSocialIcon。
export function renderEventSocialIcon(link: EventSocialLink): string {
  const meta = detectEventSocialPlatform(link.url);
  const iconClass = `event-social-link-icon event-social-link-icon-${escapeHtml(meta.key)}`;
  const image = IMAGE_ICONS[meta.key];
  if (image) {
    return `<span class="${iconClass}" aria-hidden="true"><img src="${escapeHtml(image)}" alt=""></span>`;
  }
  return `<span class="${iconClass}" aria-hidden="true">${escapeHtml(meta.icon)}</span>`;
}

// 照 A _renderEventSocialLinksHtml；所有插值皆跳脫，href 僅接受 http(s)。
export function renderEventSocialLinksHtml(links: unknown): string {
  return normalizeEventSocialLinks(links).map(link => {
    const meta = detectEventSocialPlatform(link.url);
    const label = link.label || meta.label || '連結';
    return `<a class="event-social-link-btn" data-platform="${escapeHtml(meta.key)}" href="${escapeHtml(link.url)}" target="sporthub_social" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${renderEventSocialIcon(link)}</a>`;
  }).join('');
}
