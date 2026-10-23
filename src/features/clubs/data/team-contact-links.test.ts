import { describe, expect, it } from 'vitest';

import {
  TEAM_CONTACT_LINKS_MAX,
  detectTeamContactPlatform,
  normalizeTeamContactLinks,
  normalizeTeamContactUrl,
  validateTeamContactLinksForm,
} from './team-contact-links';

describe('normalizeTeamContactUrl', () => {
  it('補 https、修剪空白、移除 hash、保留 query 與 http', () => {
    expect(normalizeTeamContactUrl(' Example.com/path?q=1#section '))
      .toBe('https://example.com/path?q=1');
    expect(normalizeTeamContactUrl('HTTP://Example.com/#a')).toBe('http://example.com/');
    expect(normalizeTeamContactUrl('example.com')).toBe('https://example.com/');
  });

  it.each([
    '', ' ', null, undefined,
    'javascript:alert(1)', 'javascript://example.com',
    'ftp://example.com/file', 'https://', 'not a valid url',
  ])('拒絕空值或非法 URL：%s', (value) => {
    expect(normalizeTeamContactUrl(value)).toBe('');
  });
});

describe('detectTeamContactPlatform', () => {
  it.each([
    ['line.me', 'line', 'LINE', 'LINE'],
    ['lin.ee', 'line', 'LINE', 'LINE'],
    ['facebook.com', 'facebook', 'Facebook', 'f'],
    ['fb.com', 'facebook', 'Facebook', 'f'],
    ['messenger.com', 'facebook', 'Facebook', 'f'],
    ['m.me', 'facebook', 'Facebook', 'f'],
    ['instagram.com', 'instagram', 'Instagram', 'IG'],
    ['threads.net', 'threads', 'Threads', '@'],
    ['threads.com', 'threads', 'Threads', '@'],
    ['x.com', 'x', 'X', 'X'],
    ['twitter.com', 'x', 'X', 'X'],
    ['youtube.com', 'youtube', 'YouTube', 'YT'],
    ['youtu.be', 'youtube', 'YouTube', 'YT'],
    ['tiktok.com', 'tiktok', 'TikTok', 'T'],
    ['discord.gg', 'discord', 'Discord', 'D'],
    ['discord.com', 'discord', 'Discord', 'D'],
    ['telegram.org', 'telegram', 'Telegram', 'TG'],
    ['telegram.me', 'telegram', 'Telegram', 'TG'],
    ['t.me', 'telegram', 'Telegram', 'TG'],
    ['linktr.ee', 'linktree', 'Linktree', 'LT'],
    ['linktree.com', 'linktree', 'Linktree', 'LT'],
    ['example.com', 'link', 'example.com', '↗'],
  ])('%s 的 key / label / icon / host 與 A 相同', (host, key, label, icon) => {
    expect(detectTeamContactPlatform(`https://${host}/club`))
      .toEqual({ key, label, icon, host });
  });

  it('接受子網域、去除 www；不將相似網域或路徑當平台', () => {
    expect(detectTeamContactPlatform('https://WWW.INSTAGRAM.COM/a')).toEqual({
      key: 'instagram', label: 'Instagram', icon: 'IG', host: 'instagram.com',
    });
    expect(detectTeamContactPlatform('https://m.facebook.com/a').key).toBe('facebook');
    for (const url of [
      'https://notfacebook.com',
      'https://facebook.com.example.com',
      'https://example.com/facebook.com',
    ]) {
      expect(detectTeamContactPlatform(url).key).toBe('link');
    }
    expect(detectTeamContactPlatform('')).toEqual({
      key: 'link', label: '連結', icon: '↗', host: '',
    });
  });
});

describe('normalizeTeamContactLinks', () => {
  it('接受字串及 url/href/link，使用者 label 優先，正規化後保序去重', () => {
    const input = [
      { url: 'line.me/a#one', label: ' 官方聯絡 ' },
      { href: 'https://line.me/a#two', label: '不覆蓋第一筆' },
      { href: 'instagram.com/club', label: ' ' },
      { link: 'example.com', label: '網站' },
      'youtube.com/club',
      null,
      { url: 'ftp://example.com' },
    ];
    const before = JSON.stringify(input);
    expect(normalizeTeamContactLinks(input)).toEqual([
      { url: 'https://line.me/a', platform: 'line', label: '官方聯絡', host: 'line.me' },
      {
        url: 'https://instagram.com/club',
        platform: 'instagram',
        label: 'Instagram',
        host: 'instagram.com',
      },
      { url: 'https://example.com/', platform: 'link', label: '網站', host: 'example.com' },
      { url: 'https://youtube.com/club', platform: 'youtube', label: 'YouTube', host: 'youtube.com' },
    ]);
    expect(JSON.stringify(input)).toBe(before);
    expect(normalizeTeamContactLinks({ url: 'example.com' })).toEqual([]);
  });

  it('去重後最多保留五個，http 與 https 為不同連結', () => {
    const result = normalizeTeamContactLinks([
      'example.com/0', 'https://example.com/0#same',
      'http://example.com/0',
      'example.com/1', 'example.com/2', 'example.com/3', 'example.com/4',
    ]);
    expect(TEAM_CONTACT_LINKS_MAX).toBe(5);
    expect(result.map((link) => link.url)).toEqual([
      'https://example.com/0',
      'http://example.com/0',
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ]);
  });
});

describe('validateTeamContactLinksForm', () => {
  it('關閉時忽略所有草稿', () => {
    expect(validateTeamContactLinksForm(false, ['javascript:alert(1)']))
      .toEqual({ enabled: false, links: [] });
    expect(validateTeamContactLinksForm(false, []))
      .toEqual({ enabled: false, links: [] });
  });

  it('全空回傳逐字錯誤', () => {
    expect(validateTeamContactLinksForm(true, ['', ' \t '])).toEqual({
      enabled: true,
      links: [],
      error: '已開啟聯絡按鈕，請至少填一個連結',
    });
  });

  it('任一非法連結回傳逐字錯誤，包含第六筆', () => {
    for (const drafts of [
      ['example.com', 'ftp://example.com'],
      [...Array.from({ length: 5 }, (_, index) => `example.com/${index}`), 'javascript:alert(1)'],
    ]) {
      expect(validateTeamContactLinksForm(true, drafts)).toEqual({
        enabled: true,
        links: [],
        error: '聯絡連結格式不正確，請以 https:// 開頭或輸入有效網址',
      });
    }
  });

  it('合法資料去空白、去重、正規化並限制五筆', () => {
    const drafts = [
      ' ', 'line.me/club', 'https://line.me/club#same',
      ...Array.from({ length: 6 }, (_, index) => `example.com/${index}`),
    ];
    const result = validateTeamContactLinksForm(true, drafts);
    expect(result).toEqual({
      enabled: true,
      links: normalizeTeamContactLinks(drafts),
    });
    expect(result.links).toHaveLength(5);
    expect(result).not.toHaveProperty('error');
  });
});
