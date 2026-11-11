import { beforeEach, describe, expect, it } from 'vitest';

import {
  EVENTS_SNAPSHOT_FORMAT,
  EVENTS_SNAPSHOT_STORAGE_KEY,
  _clearEventsSnapshotForTest,
  readEventsSnapshot,
  writeEventsSnapshot,
} from './events-snapshot-cache';
import type { EventDoc } from './types';

function ev(id: string, title: string, extra: Partial<EventDoc> = {}): EventDoc {
  return { id, title, status: 'open', date: '2099/01/01 10:00~12:00', ...extra };
}

describe('活動列表快照：帳號、可見性、時效、版本', () => {
  beforeEach(() => {
    _clearEventsSnapshotForTest();
  });

  it('訪客寫入只留訪客可見活動，信封帶目前版本', () => {
    writeEventsSnapshot(null, [
      ev('pub', '公開球局'),
      ev('sec', '私密球局', { privateEvent: true }),
      ev('team', '社團限定', { teamOnly: true }),
      ev('openTeam', '公開社團', { teamOnly: true, isPublic: true }),
      ev('blocked', '黑名單場', { blockedUids: ['U1'] }),
    ]);

    expect(readEventsSnapshot(null)?.map((event) => event.id)).toEqual(['pub', 'openTeam', 'blocked']);
    const raw = localStorage.getItem(EVENTS_SNAPSHOT_STORAGE_KEY);
    expect(raw).toContain('公開球局');
    expect(raw).toContain('公開社團');
    expect(raw).toContain('黑名單場');
    expect(raw).not.toContain('私密球局');
    expect(raw).not.toContain('社團限定');
    const parsed = JSON.parse(raw ?? '') as { v: number; owner: string };
    expect(parsed.v).toBe(EVENTS_SNAPSHOT_FORMAT);
    expect(parsed.owner).toBe('guest');
  });

  it('登入者快照保留原清單，訪客讀不到這一鍵', () => {
    writeEventsSnapshot('U1', [
      ev('pub', '只有會員看過的場'),
      ev('sec', '幹部內部', { privateEvent: true }),
    ]);

    expect(readEventsSnapshot('U1')?.map((event) => event.title)).toEqual(['只有會員看過的場', '幹部內部']);
    expect(readEventsSnapshot(null)).toBeNull();
    expect(readEventsSnapshot('U2')).toBeNull();
    const parsed = JSON.parse(localStorage.getItem(EVENTS_SNAPSHOT_STORAGE_KEY) ?? '') as { owner: string };
    expect(parsed.owner).toBe('uid:U1');
  });

  it('手改成 guest 但仍夾帶私密活動時，讀出會濾掉', () => {
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      v: EVENTS_SNAPSHOT_FORMAT,
      owner: 'guest',
      savedAt: Date.now(),
      events: [ev('pub', '公開球局'), ev('sec', '私密球局', { privateEvent: true })],
    }));

    expect(readEventsSnapshot(null)?.map((event) => event.title)).toEqual(['公開球局']);
  });

  it('超過 30 分鐘、或時間超前超過 1 分鐘，視為沒有快照', () => {
    writeEventsSnapshot(null, [ev('old', '過期場')], Date.now() - 31 * 60 * 1000);
    expect(readEventsSnapshot(null)).toBeNull();

    writeEventsSnapshot(null, [ev('future', '超前場')], Date.now() + 120_000);
    expect(readEventsSnapshot(null)).toBeNull();
  });

  it('格式版本不符或 v1 鍵整份不用，且不刪掉不相干的內容', () => {
    const bad = JSON.stringify({
      v: 1,
      owner: 'guest',
      savedAt: Date.now(),
      events: [ev('bad', '舊格式場')],
    });
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, bad);
    expect(readEventsSnapshot(null)).toBeNull();
    expect(localStorage.getItem(EVENTS_SNAPSHOT_STORAGE_KEY)).toBe(bad);

    localStorage.removeItem(EVENTS_SNAPSHOT_STORAGE_KEY);
    localStorage.setItem('fcb:events-snapshot:v1', JSON.stringify({
      owner: 'guest',
      savedAt: Date.now(),
      events: [ev('v1', '更舊的場')],
    }));
    expect(readEventsSnapshot(null)).toBeNull();
    expect(localStorage.getItem('fcb:events-snapshot:v1')).toContain('更舊的場');
  });

  it('沒有 v 的舊 v2 仍可讀；形狀不對則不用', () => {
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      owner: 'guest',
      savedAt: Date.now(),
      events: [ev('pub', '舊信封')],
    }));
    expect(readEventsSnapshot(null)?.map((event) => event.title)).toEqual(['舊信封']);

    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, '{');
    expect(readEventsSnapshot(null)).toBeNull();
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      v: EVENTS_SNAPSHOT_FORMAT,
      owner: 'guest',
      savedAt: Date.now(),
      events: { id: 'nope' },
    }));
    expect(readEventsSnapshot(null)).toBeNull();
  });
});
