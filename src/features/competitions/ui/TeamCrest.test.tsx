import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { crestIndex } from '../data/present';
import { CREST_SIZES, crestFromEntry, isInlinePngCrest, isProjectStorageDownloadUrl, TeamCrest } from './TeamCrest';

const BUCKET = FIREBASE_CONFIG.storageBucket;
const STORAGE_URL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/crests%2Fa.png?alt=media&token=t`;

describe('TeamCrest', () => {
  it('沒有網址時用首字與隊 id 的底色', () => {
    const view = render(<TeamCrest teamId="club_bird" name="  青鳥隊" teamLogo={null} size={32} />);
    expect(view.container.querySelector('img')).toBeNull();
    const mark = view.container.querySelector('.cp3-crest');
    expect(mark?.textContent).toBe('青');
    expect(mark?.className).toContain(`cp3-crest--c${crestIndex('club_bird')}`);
    expect(mark?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:32px');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });

  it('同 id 同色，跟顯示名字無關', () => {
    const first = render(<TeamCrest teamId="club_same" name="海風隊" teamLogo={null} size={64} />);
    const second = render(<TeamCrest teamId="club_same" name="完全不同的隊名" teamLogo={null} size={20} />);
    const classOf = (node: Element): string => node.querySelector('.cp3-crest')?.className ?? '';
    expect(classOf(first.container)).toBe(classOf(second.container));
    expect(classOf(first.container)).toContain(`cp3-crest--c${crestIndex('club_same')}`);
  });

  it('本專案 Storage 網址用 lazy 圖片；載入失敗退回首字', () => {
    const view = render(<TeamCrest teamId="club_wind" name="海風隊" teamLogo={STORAGE_URL} size={48} />);
    const img = view.container.querySelector('img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('src')).toBe(STORAGE_URL);
    if (!img) throw new Error('缺圖片');
    fireEvent.error(img);
    expect(view.container.querySelector('img')).toBeNull();
    const mark = view.container.querySelector('.cp3-crest');
    expect(mark?.textContent).toBe('海');
    expect(mark?.className).toContain(`cp3-crest--c${crestIndex('club_wind')}`);
    expect(mark?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:48px');
  });

  it('其他網址直接用首字底色，不畫圖片', () => {
    const foreign = [
      '#crest',
      'https://example.com/a.png',
      'http://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/a.png',
      'https://firebasestorage.googleapis.com/v0/b/other-bucket/o/a.png',
      'https://firebasestorage.googleapis.com.evil/v0/b/' + BUCKET + '/o/a.png',
      'https://user:pw@firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/a.png',
      'https://firebasestorage.googleapis.com:8443/v0/b/' + BUCKET + '/o/a.png',
    ];
    for (const url of foreign) {
      expect(isProjectStorageDownloadUrl(url)).toBe(false);
      const view = render(<TeamCrest teamId="club_wind" name="海風隊" teamLogo={url} size={32} />);
      expect(view.container.querySelector('img')).toBeNull();
      expect(view.container.querySelector('.cp3-crest')?.textContent).toBe('海');
      view.unmount();
    }
    expect(isProjectStorageDownloadUrl(STORAGE_URL)).toBe(true);
  });

  it('內嵌 PNG 畫成圖片；SVG 與過長 data URI 退回首字', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    expect(isInlinePngCrest(png)).toBe(true);
    expect(isProjectStorageDownloadUrl(png)).toBe(false);
    const view = render(<TeamCrest teamId="club_png" name="雷霆隊" teamLogo={png} size={22} />);
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(png);
    view.unmount();
    for (const url of [
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      `data:image/png;base64,${'A'.repeat(5000)}`,
    ]) {
      expect(isInlinePngCrest(url)).toBe(false);
      const rejected = render(<TeamCrest teamId="club_png" name="雷霆隊" teamLogo={url} size={22} />);
      expect(rejected.container.querySelector('img')).toBeNull();
      expect(rejected.container.querySelector('.cp3-crest')?.textContent).toBe('雷');
      rejected.unmount();
    }
  });

  it('五種尺寸都畫得出圓形框', () => {
    for (const size of CREST_SIZES) {
      const view = render(<TeamCrest teamId="club_size" name="晨星隊" teamLogo={null} size={size} />);
      expect(view.container.querySelector('.cp3-crest')?.getAttribute('style')?.replace(/\s/g, '')).toContain(`width:${size}px`);
      view.unmount();
    }
  });

  it('首字跟畫面顯示的隊名一致；報隊資料只補隊徽與隊 id', () => {
    const entries = [{ id: 'en_b', teamId: 'club_g', name: '舊隊名', teamLogo: null }] as unknown as Parameters<typeof crestFromEntry>[2];
    expect(crestFromEntry('en_b', '銀河隊', entries)).toEqual({ teamId: 'club_g', name: '銀河隊', teamLogo: null });
    expect(crestFromEntry('en_b', '', entries).name).toBe('舊隊名');
    expect(crestFromEntry('en_x', '雷霆隊', entries)).toEqual({ teamId: 'en_x', name: '雷霆隊', teamLogo: null });
  });
});
