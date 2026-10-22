import { describe, expect, it } from 'vitest';
import {
  detectEventSocialPlatform,
  normalizeEventSocialLinks,
  normalizeEventSocialUrl,
  renderEventSocialIcon,
  renderEventSocialLinksHtml,
} from './event-social-links';

describe('M-092 社群連結', () => {
  it('只接受 http(s)，拒絕可執行 scheme、控制字元與 credentials', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,test',
      'vbscript:msgbox(1)',
      'https://user:password@example.com',
      'https://example.com\\@evil.test',
      'java\nscript:alert(1)',
      {},
      null,
    ]) {
      expect(normalizeEventSocialUrl(value)).toBe('');
    }
    expect(normalizeEventSocialUrl('example.com')).toBe('https://example.com/');
    expect(normalizeEventSocialUrl('http://example.com')).toBe('http://example.com/');
  });

  it('照 A 接受 url/href/link、去重、保留標籤並最多五筆', () => {
    const links = normalizeEventSocialLinks([
      'https://example.com',
      { href: 'https://example.com/' },
      { link: 'https://instagram.com/a', label: ' 官方 ' },
      ...Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`),
    ]);
    expect(links).toHaveLength(5);
    expect(links[1]).toMatchObject({ platform: 'instagram', label: '官方' });
    expect(normalizeEventSocialLinks(null)).toEqual([]);
  });

  it('平台網域比對不接受偽裝後綴', () => {
    expect(detectEventSocialPlatform('https://www.instagram.com/a').key).toBe('instagram');
    expect(detectEventSocialPlatform('https://instagram.com.evil.test').key).toBe('link');
    expect(detectEventSocialPlatform('invalid').key).toBe('link');
  });

  it('照 A icon 與連結 DOM，文字和屬性不注入 HTML', () => {
    const html = renderEventSocialLinksHtml([
      { url: 'https://instagram.com/a', label: '"><script>alert(1)</script>' },
      'javascript:alert(1)',
    ]);
    const container = document.createElement('div');
    container.innerHTML = html;
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe('sporthub_social');
    expect(links[0]?.rel).toBe('noopener noreferrer');
    expect(links[0]?.getAttribute('aria-label')).toBe('"><script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src'))
      .toBe('/img/Instagram-Logo--Streamline-Plump-Gradient.png');
    expect(renderEventSocialIcon({
      url: 'https://example.com',
      platform: 'link',
      label: '連結',
      host: 'example.com',
    })).toContain('↗');
  });
});
