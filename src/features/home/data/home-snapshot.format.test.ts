import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BANNER_SNAPSHOT_FIELDS,
  HOME_SNAPSHOT_FORMAT_V,
  HOME_SNAPSHOT_SECTION_FIELDS,
  SPORT_SNAPSHOT_FIELDS,
  projectBanner,
  projectSportItem,
} from './home-snapshot';

interface FormatLock {
  v: number;
  section: string[];
  banner: string[];
  sport: string[];
}

// vitest 的 import.meta.url 在 jsdom 不一定是 file: 協定，改以專案根定位。
const lock = JSON.parse(
  readFileSync(path.join(process.cwd(), 'src/features/home/data/home-snapshot.format-lock.json'), 'utf8'),
) as FormatLock;

function sorted(fields: readonly string[]): string[] {
  return [...fields].sort();
}

describe('首頁快照格式守門', () => {
  it('型別欄位清單有 diff 而 v 沒變就失敗', () => {
    const live = {
      v: HOME_SNAPSHOT_FORMAT_V,
      section: sorted(HOME_SNAPSHOT_SECTION_FIELDS),
      banner: sorted(BANNER_SNAPSHOT_FIELDS),
      sport: sorted(SPORT_SNAPSHOT_FIELDS),
    };
    const locked = {
      v: lock.v,
      section: sorted(lock.section),
      banner: sorted(lock.banner),
      sport: sorted(lock.sport),
    };
    const fieldsSame = JSON.stringify({ ...live, v: 0 }) === JSON.stringify({ ...locked, v: 0 });
    if (!fieldsSame && live.v === locked.v) {
      throw new Error(
        '快照型別欄位有變但 v 沒加。請把 HOME_SNAPSHOT_FORMAT_V 加 1，並更新 home-snapshot.format-lock.json',
      );
    }
    expect(live).toEqual(locked);
  });

  it('投影出來的鍵與欄位清單一致（多寫一個鍵也會紅）', () => {
    const banner = projectBanner({
      id: 'b',
      _docId: 'b',
      status: 'active',
      type: 'promo',
      title: '標題',
      subtitle: '副標',
      titleColor: '#ffffff',
      subtitleColor: '#000000',
      image: 'https://example.com/a.webp',
      linkUrl: 'https://example.com/go',
      slotName: 'top',
      slot: 1,
      sortOrder: 2,
      gradient: 'linear-gradient(#000, #111)',
    });
    expect(banner).not.toBeNull();
    expect(Object.keys(banner as object).sort()).toEqual(sorted(BANNER_SNAPSHOT_FIELDS));
    const sport = projectSportItem({ key: 'football', count: 3 });
    expect(Object.keys(sport as object).sort()).toEqual(sorted(SPORT_SNAPSHOT_FIELDS));
  });
});
