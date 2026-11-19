import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { matchDayOf } from '../data/match-day';
import { summaryShardIdOf } from '../data/schedule-load';
import type { AudienceMatch, AudiencePorts, ParsedStats, ParsedTimeline } from '../data/audience';
import type { SummaryEntry } from '../data/types';
import type { CpInjectedEnv } from '../env';
import { CpEnvProvider } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import type { VoidMark } from '../live/types';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { S4_CREST_URL } from '../testing/step4-fixtures';
import { competition, idleActions, memberActor, screenEnv } from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';
import LiveMatchPage from './LiveMatchPage';

const LIVE_NOW = taipeiMs(2027, 1, 9, 12, 0);
const DONE_NOW = taipeiMs(2027, 1, 11, 12, 0);

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'visibilityState');
});

function mount(node: ComponentChildren) {
  return render(<LocationProvider>{node}</LocationProvider>);
}

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return mount(
    <CpEnvProvider value={env}>
      <Page />
    </CpEnvProvider>,
  );
}

/** 閉包裡才賦值。用屬性避免被控制流收成 null。 */
function cell<T>(): { current: T | null } {
  return { current: null };
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}

function summary(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id' | 'k' | 'st'>): SummaryEntry {
  return {
    dv: 'dv_adult',
    r: 1,
    no: 1,
    v: '1號場',
    h: { id: 'en_h', n: '海風隊' },
    a: { id: 'en_a', n: '山貓隊' },
    s: [0, 0],
    wo: null,
    ...partial,
  };
}

function quietPorts(over: Partial<AudiencePorts> = {}): AudiencePorts {
  return {
    watchSummary: () => () => {},
    watchMatch: () => () => {},
    readLog: async () => ({ events: [], voids: [], reads: 0 }),
    getStats: async () => ({ stalled: false, stalledMt: null, players: [] }),
    ...over,
  };
}

function liveEnv(extra: Partial<CpInjectedEnv> = {}): CpInjectedEnv {
  return {
    ...screenEnv('detail-rep'),
    now: LIVE_NOW,
    ...extra,
  };
}

function audienceMatch(partial: Partial<AudienceMatch> & Pick<AudienceMatch, 'status'>): AudienceMatch {
  return {
    id: 'mt1',
    divisionId: 'dv_adult',
    rev: 1,
    resetRev: 2,
    score: { home: 1, away: 1 },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'h1' },
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0),
    venueName: '一號場',
    venueIdx: null,
    home: { teamId: 'en_h', name: '雷霆隊', logo: null },
    away: { teamId: 'en_a', name: '海風隊', logo: null },
    penaltyScore: null,
    scoreCorrectedAt: null,
    ...partial,
  };
}

function goal(seq: number, name: string | null, no: number | null): ParsedTimeline {
  return {
    event: {
      seq,
      type: 'goal',
      op: 'goal',
      sid: '',
      side: 'home',
      plId: `pl${seq}`,
      goalKind: 'normal',
      matchSecond: seq * 60,
      createdAt: seq,
    },
    number: no,
    playerName: name,
    plId: `pl${seq}`,
    side: 'home',
  };
}

describe('詳情頁即時', () => {
  it('沒有進行中場次不監聽，注入 bundle 也不監聽', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      summary: {
        cup: [{
          id: summaryShardIdOf(LIVE_NOW),
          entries: [summary({ id: 'mt_wait', k: LIVE_NOW, st: 'scheduled' })],
        }],
      },
    });
    let watches = 0;
    const view = draw({
      actor: memberActor,
      repo,
      actions: idleActions(),
      now: LIVE_NOW,
      route: { cid: 'cup', enId: 'en_h' },
      audience: quietPorts({
        watchSummary: () => {
          watches += 1;
          return () => {};
        },
      }),
    }, CompetitionDetailPage);
    expect(await screen.findByText('海風隊')).toBeTruthy();
    expect(watches).toBe(0);
    expect(repo.calls().filter((name) => name === 'getSummaryShard')).toEqual(['getSummaryShard']);
    view.unmount();

    let bundled = 0;
    draw(liveEnv({
      schedule: { summary: [summary({ id: 'mt_live', k: LIVE_NOW, st: 'live', s: [1, 0] })], standings: [] },
      audience: quietPorts({
        watchSummary: () => {
          bundled += 1;
          return () => {};
        },
      }),
    }), CompetitionDetailPage);
    expect(await screen.findByText('即時')).toBeTruthy();
    expect(bundled).toBe(0);
  });

  it('進行中且可見才監聽今天的比賽日片，隱藏解除、回前景重掛', async () => {
    expect(summaryShardIdOf(LIVE_NOW)).toBe(matchDayOf(LIVE_NOW).shardId);
    const shardId = matchDayOf(LIVE_NOW).shardId;
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      summary: {
        cup: [{
          id: shardId,
          entries: [summary({ id: 'mt_live', k: LIVE_NOW, st: 'live', s: [1, 0] })],
        }],
      },
    });
    const watches: { cid: string; shardId: string }[] = [];
    let unsubs = 0;
    const push = cell<(rows: SummaryEntry[]) => void>();
    setVisibility('visible');
    draw({
      actor: memberActor,
      repo,
      actions: idleActions(),
      now: LIVE_NOW,
      route: { cid: 'cup', enId: 'en_h' },
      audience: quietPorts({
        watchSummary(input, onRows) {
          watches.push(input);
          push.current = onRows;
          return () => {
            unsubs += 1;
          };
        },
      }),
    }, CompetitionDetailPage);
    expect(await screen.findByText('即時')).toBeTruthy();
    expect(screen.getByText('1：0')).toBeTruthy();
    await waitFor(() => expect(watches).toEqual([{ cid: 'cup', shardId }]));
    push.current?.([summary({ id: 'mt_live', k: LIVE_NOW, st: 'live', s: [2, 1] })]);
    expect(await screen.findByText('2：1')).toBeTruthy();
    expect(repo.calls().filter((name) => name === 'getSummaryShard')).toEqual(['getSummaryShard']);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(unsubs).toBe(1);
    expect(watches).toHaveLength(1);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(watches).toHaveLength(2);
    expect(watches[1]).toEqual({ cid: 'cup', shardId });
    expect(repo.calls().filter((name) => name === 'getSummaryShard')).toEqual(['getSummaryShard']);
  });

  it('一開始隱藏就不掛，回到前景才掛', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      summary: {
        cup: [{
          id: matchDayOf(LIVE_NOW).shardId,
          entries: [summary({ id: 'mt_live', k: LIVE_NOW, st: 'live', s: [1, 0] })],
        }],
      },
    });
    let watches = 0;
    setVisibility('hidden');
    draw({
      actor: memberActor,
      repo,
      actions: idleActions(),
      now: LIVE_NOW,
      route: { cid: 'cup', enId: 'en_h' },
      audience: quietPorts({
        watchSummary: () => {
          watches += 1;
          return () => {};
        },
      }),
    }, CompetitionDetailPage);
    expect(await screen.findByText('即時')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(watches).toBe(0);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(watches).toBe(1);
  });

  it('列表顯示即時、更正、PK、場地與隔日時刻，每一列都能進單場頁', async () => {
    const previous = `${window.location.pathname}${window.location.search}`;
    let stats = 0;
    const view = draw(liveEnv({
      schedule: {
        summary: [
          summary({
            id: 'mt_live',
            k: LIVE_NOW,
            st: 'live',
            s: [1, 0],
            h: { id: 'en_h', n: '雷霆隊', l: S4_CREST_URL },
            a: { id: 'en_a', n: '海風隊' },
          }),
          summary({
            id: 'mt_fix',
            k: taipeiMs(2027, 1, 9, 14, 30),
            st: 'confirmed',
            s: [2, 1],
            v: '確認場',
            vi: 0,
            cx: 50,
            p: [4, 3],
          }),
          summary({
            id: 'mt_open',
            k: taipeiMs(2027, 1, 9, 9, 0),
            st: 'scheduled',
            v: '舊名',
            vi: 0,
          }),
          summary({
            id: 'mt_early',
            k: taipeiMs(2027, 1, 10, 1, 30),
            st: 'scheduled',
          }),
          summary({
            id: 'mt_reset',
            k: taipeiMs(2027, 1, 9, 16, 0),
            st: 'scheduled',
            cx: 80,
          }),
        ],
        standings: [],
      },
      audience: quietPorts({
        getStats: async () => {
          stats += 1;
          return { stalled: false, stalledMt: null, players: [] };
        },
      }),
    }), CompetitionDetailPage);
    expect(await screen.findByText('即時')).toBeTruthy();
    expect(screen.getByText('比分已更正')).toBeTruthy();
    const pk = screen.getByText('PK 4:3');
    expect(pk.classList.contains('cp3-m__pk')).toBe(true);
    expect(pk.closest('.s')).toBeNull();
    expect(pk.parentElement?.className).toBe('cp3-m__vs');
    const score = pk.parentElement?.querySelector('.s');
    expect(score?.className).toBe('s');
    expect(score?.textContent).toBe('2：1');
    const pkRow = pk.closest('.cp3-m');
    expect(view.container.querySelectorAll('.cp3-m__pk')).toHaveLength(1);
    for (const row of view.container.querySelectorAll('.cp3-m')) {
      if (row !== pkRow) expect(row.querySelector('.cp3-m__pk')).toBeNull();
    }
    expect(view.container.textContent ?? '').toContain('隔日 01:30');
    expect(view.container.textContent ?? '').toContain('09:00　示範球場');
    expect(view.container.textContent ?? '').toContain('14:30　確認場');
    expect(view.container.textContent ?? '').not.toContain('舊名');
    const reset = [...view.container.querySelectorAll('.cp3-m')].find((node) => node.textContent?.includes('16:00'));
    expect(reset?.textContent ?? '').not.toContain('比分已更正');
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(S4_CREST_URL);
    expect(view.container.querySelector('.cp3-m')?.getAttribute('role')).toBeNull();
    expect(stats).toBe(0);
    const row = [...view.container.querySelectorAll('.cp3-m')].find((node) => node.textContent?.includes('09:00'));
    if (!row) throw new Error('找不到未開賽列');
    fireEvent.click(row);
    await waitFor(() => expect(window.location.pathname).toBe('/competitions/cup/matches/mt_open/live'));
    window.history.pushState(null, '', previous || '/');
  });
});

describe('射手榜分頁', () => {
  function statsOf(name: string): ParsedStats {
    return {
      stalled: false,
      stalledMt: null,
      players: [{ plId: 'pl1', n: name, e: 'en_a', g: 2, y: 0, r: 0 }],
    };
  }

  it('打開才讀，切組與再打開各再讀一次；載入前不閃空狀態', async () => {
    const calls: string[] = [];
    const release = cell<(value: ParsedStats) => void>();
    draw(liveEnv({
      schedule: { summary: [summary({ id: 'mt_live', k: LIVE_NOW, st: 'scheduled' })], standings: [] },
      audience: quietPorts({
        getStats: (_cid, dvId) => {
          calls.push(dvId);
          return new Promise((resolve) => {
            release.current = resolve;
          });
        },
      }),
    }), CompetitionDetailPage);
    expect(await screen.findByRole('tab', { name: '射手榜' })).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: '射手榜' }));
    await waitFor(() => expect(calls).toEqual(['dv_adult']));
    expect(screen.queryByText('還沒有已確認的比賽紀錄')).toBeNull();
    release.current?.(statsOf('王一'));
    expect(await screen.findByText('王一')).toBeTruthy();
    expect(screen.getByText('示範隊A')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'U12' }));
    await waitFor(() => expect(calls).toEqual(['dv_adult', 'dv_u12']));
    release.current?.(statsOf('少年'));
    expect(await screen.findByText('少年')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '賽程' }));
    fireEvent.click(screen.getAllByRole('tab', { name: '射手榜' })[0] as HTMLElement);
    await waitFor(() => expect(calls).toEqual(['dv_adult', 'dv_u12', 'dv_u12']));
  });

  it('沒有組別就不讀；失敗顯示空狀態；停更橫幅不顯示場次', async () => {
    const base = screenEnv('detail-rep');
    let reads = 0;
    draw({
      ...base,
      now: LIVE_NOW,
      bundle: base.bundle ? { ...base.bundle, divisions: [] } : undefined,
      schedule: { summary: [summary({ id: 'mt', k: LIVE_NOW, st: 'scheduled', dv: '' })], standings: [] },
      audience: quietPorts({
        getStats: async () => {
          reads += 1;
          return { stalled: false, stalledMt: null, players: [] };
        },
      }),
    }, CompetitionDetailPage);
    fireEvent.click(await screen.findByRole('tab', { name: '射手榜' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads).toBe(0);
    cleanup();

    draw(liveEnv({
      schedule: { summary: [summary({ id: 'mt', k: LIVE_NOW, st: 'scheduled' })], standings: [] },
      audience: quietPorts({
        getStats: async () => {
          throw new Error('讀不到');
        },
      }),
    }), CompetitionDetailPage);
    fireEvent.click(await screen.findByRole('tab', { name: '射手榜' }));
    expect(await screen.findByText('還沒有已確認的比賽紀錄')).toBeTruthy();
    cleanup();

    draw(liveEnv({
      schedule: { summary: [summary({ id: 'mt', k: LIVE_NOW, st: 'scheduled' })], standings: [] },
      audience: quietPorts({
        getStats: async () => ({
          stalled: true,
          stalledMt: 'mt_secret',
          players: [{ plId: 'pl1', n: '王一', e: 'en_missing', g: 1, y: 1, r: 0 }],
        }),
      }),
    }), CompetitionDetailPage);
    fireEvent.click(await screen.findByRole('tab', { name: '射手榜' }));
    const stalled = await screen.findByText('射手榜已停止更新');
    expect(stalled.classList.contains('s4-banner')).toBe(true);
    expect(stalled.classList.contains('s4-banner--quiet')).toBe(true);
    expect(screen.getAllByText('王一').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('mt_secret')).toBeNull();
  });

  it('已結束另有射手榜按鈕，賽程折疊還在，再按再讀', async () => {
    const calls: string[] = [];
    draw(liveEnv({
      now: DONE_NOW,
      schedule: { summary: [], standings: [] },
      audience: quietPorts({
        getStats: async (_cid, dvId) => {
          calls.push(dvId);
          return { stalled: false, stalledMt: null, players: [] };
        },
      }),
    }), CompetitionDetailPage);
    expect(await screen.findByRole('button', { name: '賽程' })).toBeTruthy();
    const open = screen.getByRole('button', { name: '射手榜' });
    expect(calls).toEqual([]);
    fireEvent.click(open);
    await waitFor(() => expect(calls).toEqual(['dv_adult']));
    expect(await screen.findByText('還沒有已確認的比賽紀錄')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '射手榜' }));
    await waitFor(() => expect(calls).toEqual(['dv_adult', 'dv_adult']));
    expect(screen.getByRole('button', { name: '賽程' })).toBeTruthy();
  });
});

describe('單場頁', () => {
  function drawMatch(env: CpInjectedEnv) {
    return draw({ ...env, route: { cid: 'cup', enId: 'en_h', mtId: 'mt1' } }, LiveMatchPage);
  }

  it('讀不到顯示既有空狀態，返回賽事頁；有 bundle 且沒有 audience 不監聽', async () => {
    const previous = `${window.location.pathname}${window.location.search}`;
    drawMatch(liveEnv({
      audience: quietPorts({
        watchMatch: (_input, onMatch) => {
          onMatch({ kind: 'missing' });
          return () => {};
        },
      }),
    }));
    expect(await screen.findByText('找不到這場比賽')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(window.location.pathname).toBe('/competitions/cup'));
    window.history.pushState(null, '', previous || '/');
    cleanup();

    let blocked = 0;
    draw(liveEnv({
      route: { cid: 'cup', enId: 'en_h', mtId: 'mt1' },
      audience: quietPorts({
        watchMatch: () => {
          blocked += 1;
          return () => {};
        },
      }),
    }), LiveMatchPage);
    // 上面這次有 audience，會監聽。接著拿掉 audience，bundle 直接顯示空狀態。
    cleanup();
    expect(blocked).toBe(1);
    blocked = 0;
    draw(liveEnv({ route: { cid: 'cup', enId: 'en_h', mtId: 'mt1' } }), LiveMatchPage);
    expect(await screen.findByText('找不到這場比賽')).toBeTruthy();
    expect(blocked).toBe(0);
  });

  it('未登入也看得到；未開賽只顯示賽前資訊；已結束顯示 PK 與更正', async () => {
    const push = cell<(match: AudienceMatch) => void>();
    drawMatch({
      ...liveEnv(),
      actor: { ...memberActor, uid: '' },
      audience: quietPorts({
        watchMatch: (_input, onMatch) => {
          onMatch({ kind: 'ok', match: audienceMatch({ status: 'scheduled' }) });
          push.current = (match) => onMatch({ kind: 'ok', match });
          return () => {};
        },
      }),
    });
    expect(await screen.findByText('雷霆隊')).toBeTruthy();
    expect(document.querySelector('.s4-stage')?.textContent).toBe('09:00　一號場');
    expect(document.querySelector('.s4-clock')).toBeNull();
    expect(screen.queryByText('上半場')).toBeNull();

    push.current?.(audienceMatch({
      status: 'finished',
      score: { home: 2, away: 1 },
      penaltyScore: { home: 0, away: 0 },
      scoreCorrectedAt: 10,
    }));
    expect(await screen.findByText('PK 0:0')).toBeTruthy();
    expect(screen.getByText('比分已更正')).toBeTruthy();
    expect(screen.getByText('2:1')).toBeTruthy();
  });

  it('收合不讀；展開從 resetRev 讀；rev 變大只補讀；收合後不再讀', async () => {
    const calls: {
      afterEvents: number;
      afterVoids: number;
      alreadyEvents: number;
      alreadyVoids: number;
    }[] = [];
    const release = cell<(value: { events: ParsedTimeline[]; voids: VoidMark[]; reads: number }) => void>();
    const push = cell<(match: AudienceMatch) => void>();
    const view = drawMatch(liveEnv({
      audience: quietPorts({
        watchMatch: (_input, onMatch) => {
          const send = (match: AudienceMatch) => onMatch({ kind: 'ok', match });
          send(audienceMatch({ status: 'live', rev: 4 }));
          push.current = send;
          return () => {};
        },
        readLog: async (input) => {
          calls.push({
            afterEvents: input.afterEvents,
            afterVoids: input.afterVoids,
            alreadyEvents: input.alreadyEvents,
            alreadyVoids: input.alreadyVoids,
          });
          return new Promise((resolve) => {
            release.current = resolve;
          });
        },
      }),
    }));
    expect(await screen.findByText('雷霆隊')).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '比賽紀錄' }));
    await waitFor(() => expect(calls).toEqual([{
      afterEvents: 2, afterVoids: 2, alreadyEvents: 0, alreadyVoids: 0,
    }]));
    const voided = goal(4, '張宇軒', 7);
    release.current?.({
      events: [voided, goal(5, '劉冠廷', 9)],
      voids: [{ targetSeq: 4, seq: 6, createdAt: 6 }],
      reads: 4,
    });
    expect(await screen.findByText("5' 雷霆隊 9 劉冠廷")).toBeTruthy();
    expect(view.container.querySelector('.s4-ev--void')?.textContent ?? '').toContain('已復原');

    push.current?.(audienceMatch({ status: 'live', rev: 5 }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ afterEvents: 5, afterVoids: 6, alreadyEvents: 2, alreadyVoids: 1 });
    release.current?.({
      events: [{
        event: {
          seq: 8, type: 'pk', op: 'pk', sid: '', side: 'home', scored: true, matchSecond: 500, createdAt: 8,
        },
        number: null,
        playerName: null,
        plId: null,
        side: 'home',
      }],
      voids: [],
      reads: 2,
    });
    await waitFor(() => {
      const mains = [...document.querySelectorAll('.s4-ev__main')].map((node) => node.textContent);
      expect(mains).toContain('第1輪 雷霆隊 不指定球員 進');
    });

    fireEvent.click(screen.getByRole('button', { name: '比賽紀錄' }));
    push.current?.(audienceMatch({ status: 'live', rev: 9 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
  });

  it('隱藏時解除場次監聽，回前景重掛', async () => {
    let watches = 0;
    let unsubs = 0;
    setVisibility('visible');
    drawMatch(liveEnv({
      audience: quietPorts({
        watchMatch: (_input, onMatch) => {
          watches += 1;
          onMatch({ kind: 'ok', match: audienceMatch({ status: 'live' }) });
          return () => {
            unsubs += 1;
          };
        },
      }),
    }));
    expect(await screen.findByText('雷霆隊')).toBeTruthy();
    expect(watches).toBe(1);
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(unsubs).toBe(1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(watches).toBe(2);
  });
});
