import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-042：index.html 的連線提示（preconnect／dns-prefetch）。靜態檢查，不連網。
const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));

function linkTags(rel: string): string[] {
  return Array.from(head.matchAll(new RegExp(`<link rel="${rel}"[^>]*>`, 'g')), (m) => m[0]);
}

describe('index.html 連線提示', () => {
  it('firestore 預先連線帶 crossorigin（讀取是 CORS 請求，沒帶就不會重用這條連線）', () => {
    expect(linkTags('preconnect')).toContain('<link rel="preconnect" href="https://firestore.googleapis.com" crossorigin />');
  });

  it('firebasestorage 預先連線不帶 crossorigin（橫幅圖是一般 <img>）', () => {
    expect(linkTags('preconnect')).toContain('<link rel="preconnect" href="https://firebasestorage.googleapis.com" />');
  });

  it('其餘來源只做 DNS 預解析，不占連線', () => {
    const prefetch = linkTags('dns-prefetch');
    for (const host of [
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'www.googleapis.com',
      'fc-football-6c8dc.firebaseapp.com',
    ]) {
      expect(prefetch.some((tag) => tag.includes(`https://${host}`))).toBe(true);
    }
    expect(linkTags('preconnect')).toHaveLength(2);
  });

  it('提示放在第一個 <script> 之前（越早越好）', () => {
    const firstScript = head.indexOf('<script');
    expect(firstScript).toBeGreaterThan(-1);
    for (const tag of [...linkTags('preconnect'), ...linkTags('dns-prefetch')]) {
      expect(head.indexOf(tag)).toBeLessThan(firstScript);
    }
  });
});
