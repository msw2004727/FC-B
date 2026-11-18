import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { crestIndex } from '../data/present';
import { CREST_SIZES, isProjectStorageDownloadUrl, TeamCrest } from './TeamCrest';

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

  it('五種尺寸都畫得出圓形框', () => {
    for (const size of CREST_SIZES) {
      const view = render(<TeamCrest teamId="club_size" name="晨星隊" teamLogo={null} size={size} />);
      expect(view.container.querySelector('.cp3-crest')?.getAttribute('style')?.replace(/\s/g, '')).toContain(`width:${size}px`);
      view.unmount();
    }
  });
});
