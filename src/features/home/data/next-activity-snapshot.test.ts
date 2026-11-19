import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextActivityResult } from './next-activity';
import {
  NEXT_ACTIVITY_SNAPSHOT_FORMAT_V,
  NEXT_ACTIVITY_SNAPSHOT_KEY,
  NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS,
  readNextActivitySnapshot,
} from './next-activity-snapshot';
import { removeNextActivitySnapshot, writeNextActivitySnapshot } from './next-activity-snapshot-write';

const NOW = Date.UTC(2026, 10, 19, 4, 0, 0);

function result(extra: Record<string, unknown> = {}, reg: Record<string, unknown> | null = { status: 'confirmed' }): NextActivityResult {
  return {
    event: {
      id: 'e1',
      _docId: 'ce_1',
      title: '週四夜間足球',
      date: '2026/11/20 20:00~22:00',
      location: '大安運動中心',
      image: 'https://cdn.example/a.jpg',
      imageVariants: { homeNext: 'https://cdn.example/h.jpg', cover: 'https://cdn.example/c.jpg' },
      ...extra,
    },
    registration: reg as NextActivityResult['registration'],
    managedRole: '',
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('首頁我的下一場：本機快照', () => {
  it('寫入只留畫面欄位與 owner；讀回同一份內容', () => {
    writeNextActivitySnapshot('u1', result({ blockedUids: ['x'], participants: ['p1'], creatorUid: 'c1' }, {
      status: 'confirmed',
      userId: 'u1',
      userName: '某人',
    }), NOW);
    const raw = localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY) as string;
    expect(raw).not.toContain('blockedUids');
    expect(raw).not.toContain('participants');
    expect(raw).not.toContain('creatorUid');
    expect(raw).not.toContain('userName');
    expect(raw).not.toContain('ce_1');
    const read = readNextActivitySnapshot(NOW + 1000);
    expect(read?.owner).toBe('u1');
    expect(read?.savedAt).toBe(NOW);
    expect(read?.result).toEqual({
      event: {
        id: 'e1',
        title: '週四夜間足球',
        date: '2026/11/20 20:00~22:00',
        location: '大安運動中心',
        image: 'https://cdn.example/a.jpg',
        imageVariants: { homeNext: 'https://cdn.example/h.jpg', cover: 'https://cdn.example/c.jpg' },
      },
      registration: { status: 'confirmed' },
      managedRole: '',
    });
  });

  it('活動已開始、超過 7 天、寫入時間在未來、格式版本不同都視為沒有快照', () => {
    writeNextActivitySnapshot('u1', result(), NOW);
    const start = Date.parse('2026-11-20T12:00:00Z');
    expect(readNextActivitySnapshot(start - 1000)).not.toBeNull();
    expect(readNextActivitySnapshot(start + 1000)).toBeNull();

    writeNextActivitySnapshot('u1', result({ date: '2026/12/30 20:00~22:00' }), NOW);
    expect(readNextActivitySnapshot(NOW + NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS)).not.toBeNull();
    expect(readNextActivitySnapshot(NOW + NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
    expect(readNextActivitySnapshot(NOW - 2 * 60_000)).toBeNull();

    const stored = JSON.parse(localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY) as string) as Record<string, unknown>;
    localStorage.setItem(NEXT_ACTIVITY_SNAPSHOT_KEY, JSON.stringify({ ...stored, v: NEXT_ACTIVITY_SNAPSHOT_FORMAT_V + 1 }));
    expect(readNextActivitySnapshot(NOW + 1000)).toBeNull();
  });

  it('非 http(s) 圖片網址丟掉；沒有日期字串或公開 id 的活動不存並刪掉舊的', () => {
    writeNextActivitySnapshot('u1', result({ image: 'javascript:alert(1)', imageVariants: { homeNext: 'data:x' } }), NOW);
    const read = readNextActivitySnapshot(NOW + 1000);
    expect(read?.result.event.image).toBeUndefined();
    expect(read?.result.event.imageVariants?.homeNext).toBeUndefined();
    expect(read?.result.event.imageVariants?.cover).toBeUndefined();
    expect(localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY)).not.toContain('javascript:');

    writeNextActivitySnapshot('u1', result({ date: undefined, startAt: { seconds: 1 } }), NOW);
    expect(localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY)).toBeNull();
    writeNextActivitySnapshot('u1', result(), NOW);
    writeNextActivitySnapshot('u1', result({ id: '' }), NOW);
    expect(localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY)).toBeNull();
    writeNextActivitySnapshot('', result(), NOW);
    expect(localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY)).toBeNull();
  });

  it('壞掉的 JSON 或 localStorage 不可用都安靜退回沒有快照', () => {
    localStorage.setItem(NEXT_ACTIVITY_SNAPSHOT_KEY, '{oops');
    expect(readNextActivitySnapshot(NOW)).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readNextActivitySnapshot(NOW)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeNextActivitySnapshot('u1', result(), NOW)).not.toThrow();
    expect(() => removeNextActivitySnapshot()).not.toThrow();
  });
});
