import { cleanup, render } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EVENTS_SNAPSHOT_FORMAT,
  EVENTS_SNAPSHOT_STORAGE_KEY,
  _clearEventsSnapshotForTest,
  writeEventsSnapshot,
} from './events-snapshot-cache';
import type { EventDoc } from './types';

const loadEventsStatic = vi.fn<() => Promise<string[]>>();
let knownUid: string | null | undefined;

vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => knownUid }));
vi.mock('./events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic,
    getSnapshot: () => ({ active: [], terminal: [], activeFromCache: false }),
  }),
}));

const { useEvents, _resetUseEventsForTest } = await import('./use-events');

function ev(id: string, title: string, extra: Partial<EventDoc> = {}): EventDoc {
  return { id, title, status: 'open', date: '2099/06/01 10:00~12:00', ...extra };
}

let shown: EventDoc[] = [];

function Probe({ uid = null }: { uid?: string | null }): preact.JSX.Element {
  const { events, loading, error } = useEvents(uid);
  shown = events;
  return h('div', { 'data-testid': 'p' }, `${loading ? 'L' : '-'}${error ? 'E' : '-'}:${events.map((event) => event.title).join('|')}`);
}

function titles(): string[] {
  return shown.map((event) => event.title ?? '');
}

describe('SPEED-1-1 訪客先畫 guest 快照，且不畫登入者快照', () => {
  beforeEach(() => {
    _resetUseEventsForTest();
    _clearEventsSnapshotForTest();
    loadEventsStatic.mockReset();
    loadEventsStatic.mockImplementation(() => new Promise(() => undefined));
    knownUid = undefined;
    shown = [];
  });

  afterEach(() => cleanup());

  it('登入狀態尚未確定時，第一次 render 就畫 guest 快照', () => {
    writeEventsSnapshot(null, [ev('g', '訪客公開場')]);
    const view = render(h(Probe, { uid: null }));
    expect(view.getByTestId('p').textContent).toBe('--:訪客公開場');
    expect(titles()).toEqual(['訪客公開場']);
    expect(knownUid).toBeUndefined();
  });

  it('先寫登入者快照，再以訪客開頁：畫面與回傳都不含該內容', () => {
    writeEventsSnapshot('U1', [
      ev('seen', '只有會員看過的場'),
      ev('sec', '幹部內部', { privateEvent: true }),
    ]);

    const view = render(h(Probe, { uid: null }));
    expect(view.getByTestId('p').textContent).toBe('L-:');
    expect(titles()).not.toContain('只有會員看過的場');
    expect(titles()).not.toContain('幹部內部');
    expect(shown).toEqual([]);

    knownUid = 'U1';
    view.rerender(h(Probe, { uid: 'U1' }));
    expect(view.getByTestId('p').textContent).toContain('只有會員看過的場');
    expect(view.getByTestId('p').textContent).toContain('幹部內部');
    expect(titles()).toEqual(['幹部內部', '只有會員看過的場']);
  });

  it('訪客→登入：換成登入者後不再畫 guest 快照；帳號未確認時也不畫登入者快照', () => {
    writeEventsSnapshot(null, [ev('g', '訪客公開場')]);
    const view = render(h(Probe, { uid: null }));
    expect(view.getByTestId('p').textContent).toBe('--:訪客公開場');

    view.rerender(h(Probe, { uid: 'U1' }));
    expect(view.getByTestId('p').textContent).toBe('L-:');
    expect(titles()).not.toContain('訪客公開場');
    expect(shown).toEqual([]);
  });

  it('登入→登出：viewer 已是訪客時，即使登入確認還沒清掉，也不再畫登入者快照', () => {
    writeEventsSnapshot('U1', [
      ev('seen', '只有會員看過的場'),
      ev('sec', '幹部內部', { privateEvent: true }),
    ]);
    knownUid = 'U1';
    const view = render(h(Probe, { uid: 'U1' }));
    expect(titles()).toEqual(['幹部內部', '只有會員看過的場']);

    view.rerender(h(Probe, { uid: null }));
    expect(view.getByTestId('p').textContent).toBe('L-:');
    expect(titles()).not.toContain('只有會員看過的場');
    expect(titles()).not.toContain('幹部內部');
    expect(shown).toEqual([]);

    knownUid = null;
    view.rerender(h(Probe, { uid: null }));
    expect(shown).toEqual([]);
    expect(view.getByTestId('p').textContent).not.toContain('只有會員看過的場');
    expect(view.getByTestId('p').textContent).not.toContain('幹部內部');
  });

  it('快照過期或版本不符時，訪客第一次 render 不畫那份內容', () => {
    writeEventsSnapshot(null, [ev('old', '過期場')], Date.now() - 31 * 60 * 1000);
    const expired = render(h(Probe, { uid: null }));
    expect(expired.getByTestId('p').textContent).toBe('L-:');
    expect(titles()).not.toContain('過期場');
    cleanup();

    _resetUseEventsForTest();
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      v: 1,
      owner: 'guest',
      savedAt: Date.now(),
      events: [ev('bad', '舊格式場')],
    }));
    expect(EVENTS_SNAPSHOT_FORMAT).not.toBe(1);
    const mismatch = render(h(Probe, { uid: null }));
    expect(mismatch.getByTestId('p').textContent).toBe('L-:');
    expect(titles()).not.toContain('舊格式場');
    expect(shown).toEqual([]);
  });

  it('guest 鍵被塞進非訪客可見活動時，畫面與回傳都沒有', () => {
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      v: EVENTS_SNAPSHOT_FORMAT,
      owner: 'guest',
      savedAt: Date.now(),
      events: [
        ev('pub', '公開球局'),
        ev('sec', '私密球局', { privateEvent: true }),
        ev('team', '社團限定', { teamOnly: true }),
        ev('openTeam', '公開社團', { teamOnly: true, isPublic: true }),
      ],
    }));

    const view = render(h(Probe, { uid: null }));
    expect(view.getByTestId('p').textContent).toBe('--:公開社團|公開球局');
    expect(titles()).toEqual(['公開社團', '公開球局']);
  });
});
