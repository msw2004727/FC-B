// 對應 A js/modules/team/team-contact-links.js:_teamContactLinksMax
export const TEAM_CONTACT_LINKS_MAX = 5;

export type TeamContactPlatformKey =
  | 'line'
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'discord'
  | 'telegram'
  | 'linktree'
  | 'link';

export interface TeamContactLink {
  url: string;
  platform: TeamContactPlatformKey;
  label: string;
  host: string;
}

export interface TeamContactPlatform {
  key: TeamContactPlatformKey;
  label: string;
  icon: string;
  host: string;
}

export interface TeamContactLinksFormData {
  enabled: boolean;
  links: TeamContactLink[];
  error?: string;
}

// 對應 A js/modules/team/team-contact-links.js:_normalizeTeamContactUrl
export function normalizeTeamContactUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

// 對應 A js/modules/team/team-contact-links.js:_detectTeamContactPlatform
export function detectTeamContactPlatform(value: unknown): TeamContactPlatform {
  const normalized = normalizeTeamContactUrl(value);
  const host = normalized
    ? new URL(normalized).hostname.toLowerCase().replace(/^www\./, '')
    : '';
  const matches = (...domains: string[]): boolean =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

  if (matches('line.me', 'lin.ee')) return { key: 'line', label: 'LINE', icon: 'LINE', host };
  if (matches('facebook.com', 'fb.com', 'messenger.com', 'm.me')) {
    return { key: 'facebook', label: 'Facebook', icon: 'f', host };
  }
  if (matches('instagram.com')) return { key: 'instagram', label: 'Instagram', icon: 'IG', host };
  if (matches('threads.net', 'threads.com')) return { key: 'threads', label: 'Threads', icon: '@', host };
  if (matches('x.com', 'twitter.com')) return { key: 'x', label: 'X', icon: 'X', host };
  if (matches('youtube.com', 'youtu.be')) return { key: 'youtube', label: 'YouTube', icon: 'YT', host };
  if (matches('tiktok.com')) return { key: 'tiktok', label: 'TikTok', icon: 'T', host };
  if (matches('discord.gg', 'discord.com')) return { key: 'discord', label: 'Discord', icon: 'D', host };
  if (matches('telegram.org', 'telegram.me', 't.me')) {
    return { key: 'telegram', label: 'Telegram', icon: 'TG', host };
  }
  if (matches('linktr.ee', 'linktree.com')) return { key: 'linktree', label: 'Linktree', icon: 'LT', host };
  return { key: 'link', label: host || '連結', icon: '↗', host };
}

// 對應 A js/modules/team/team-contact-links.js:_normalizeTeamContactLinks
export function normalizeTeamContactLinks(value: unknown): TeamContactLink[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: TeamContactLink[] = [];

  for (const item of list) {
    const record = typeof item === 'object' && item !== null
      ? item as Record<string, unknown>
      : null;
    const rawUrl = typeof item === 'string'
      ? item
      : record?.['url'] || record?.['href'] || record?.['link'] || '';
    const url = normalizeTeamContactUrl(rawUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const meta = detectTeamContactPlatform(url);
    const rawLabel = record ? String(record['label'] || '').trim() : '';
    normalized.push({
      url,
      platform: meta.key,
      label: rawLabel || meta.label,
      host: meta.host,
    });
  }

  return normalized.slice(0, TEAM_CONTACT_LINKS_MAX);
}

// 對應 A js/modules/team/team-contact-links.js:_getTeamContactLinksFormData
export function validateTeamContactLinksForm(
  enabled: boolean,
  drafts: string[],
): TeamContactLinksFormData {
  if (!enabled) return { enabled: false, links: [] };
  const nonEmpty = drafts.map((value) => String(value || '').trim()).filter(Boolean);
  if (nonEmpty.length === 0) {
    return {
      enabled: true,
      links: [],
      error: '已開啟聯絡按鈕，請至少填一個連結',
    };
  }
  if (nonEmpty.some((value) => !normalizeTeamContactUrl(value))) {
    return {
      enabled: true,
      links: [],
      error: '聯絡連結格式不正確，請以 https:// 開頭或輸入有效網址',
    };
  }

  const links = normalizeTeamContactLinks(nonEmpty);
  return { enabled: links.length > 0, links };
}
