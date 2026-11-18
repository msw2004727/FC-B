import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InAppListCard } from '../data/list-cards';
import { CpEnvProvider } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { NOW, competition, idleActions, memberActor } from '../testing/screen-fixtures';
import { InAppCardList } from './InAppCardList';
import { InAppSection } from './InAppSection';

const IDE = '\u3000';
const EN = '\u2013';
const DOT = '\u30FB';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
});

function card(partial: Partial<InAppListCard> & Pick<InAppListCard, 'cid' | 'name' | 'category' | 'phase'>): InAppListCard {
  return {
    dates: '',
    line: null,
    mine: false,
    ended: partial.phase === 'done',
    ...partial,
  };
}

describe('站內卡文案與分類小標', () => {
  it('進行中與冠軍用預覽句子；小標有文字；封面不載圖', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    render(
      <InAppCardList
        cards={[
          card({
            cid: 'live',
            name: '示範盃五人制足球賽',
            category: 'cup',
            phase: 'live',
            dates: `2027/01/09 ${EN} 01/10${IDE}示範運動公園`,
            line: { kind: 'live', count: 3, time: '14:30' },
          }),
          card({
            cid: 'done',
            name: '秋季聯賽',
            category: 'league',
            phase: 'done',
            dates: `2026/10/03 ${EN} 11/21`,
            line: { kind: 'champion', name: '海風隊' },
          }),
        ]}
        ct={ct}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />,
    );
    const live = document.querySelector('[data-cid="live"]');
    expect(live?.querySelector('.cpl-st--live')?.textContent).toContain('進行中');
    expect(live?.querySelector('.cpl-line')?.textContent).toBe(`今天 3 場${DOT}下一場 14:30`);
    expect(live?.querySelector('.cpl-line--hl')).toBeTruthy();
    expect(live?.querySelector('.cpl-chip')?.textContent).toBe('盃賽');
    expect(live?.querySelector('.cpl-chip')?.className).toContain('cpl-chip--cup');
    expect(live?.querySelector('.cpl-cover--cup')).toBeTruthy();
    expect(live?.querySelector('img')).toBeNull();
    const done = document.querySelector('[data-cid="done"]');
    expect(done?.classList.contains('ended')).toBe(true);
    expect(done?.querySelector('.cpl-line')?.textContent).toBe(`冠軍${IDE}海風隊`);
    for (const chip of document.querySelectorAll('.cpl-chip')) {
      expect((chip.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
    expect(document.querySelector('[class*="amber"]')).toBeNull();
  });
});

describe('站內清單篩選不重讀', () => {
  function repoFor() {
    return createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: {
        uid_member: [{ id: 'm1', cid: 'mine_only', roles: ['host'], host: true, name: '只屬於我', category: 'cup' }],
      },
      competitions: [
        competition({ id: 'rec_lg', name: '招募聯賽', category: 'league', hostType: 'personal', hostTeamId: null }),
        competition({
          id: 'warm_cup',
          name: '預熱盃',
          category: 'cup',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 12, 9, 23, 59),
          firstMatchAt: taipeiMs(2026, 12, 13, 9, 0),
          lastMatchAt: taipeiMs(2026, 12, 14, 18, 0),
        }),
        competition({
          id: 'live_fr',
          name: '進行友誼',
          category: 'friendly',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 12, 1, 23, 59),
          firstMatchAt: NOW - 60 * 60 * 1000,
          lastMatchAt: NOW + 24 * 60 * 60 * 1000,
        }),
        competition({
          id: 'done_lg',
          name: '結束聯賽',
          category: 'league',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 9, 1, 23, 59),
          firstMatchAt: taipeiMs(2026, 10, 3, 8, 0),
          lastMatchAt: taipeiMs(2026, 11, 21, 18, 0),
        }),
      ],
    });
  }

  async function chooseStatus(value: string): Promise<void> {
    const select = document.getElementById('cpl-status') as HTMLSelectElement;
    select.value = value;
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('預設未結束，切狀態、分類、只看我的都不加查詢', async () => {
    const repo = repoFor();
    const env = { actor: memberActor, repo, actions: idleActions(), now: NOW };
    const view = render(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(await screen.findByText('招募聯賽')).toBeTruthy();
    const select = document.getElementById('cpl-status') as HTMLSelectElement;
    expect(select.value).toBe('open');
    expect([...select.options].map((option) => option.text)).toEqual([
      '未結束', '招募中', '預熱中', '進行中', '已結束', '全部',
    ]);
    expect(document.querySelector('[data-cid="done_lg"]')).toBeNull();

    const rec = document.querySelector('[data-cid="rec_lg"]');
    expect(rec?.querySelector('.tc-card-dates')?.textContent).toBe(`2027/01/09 ${EN} 01/10${IDE}示範球場`);
    expect(rec?.querySelector('.cpl-line')?.textContent).toBe(`報名截止${IDE}12/20 23:59`);
    expect(rec?.querySelector('.cpl-line')?.classList.contains('cpl-line--hl')).toBe(false);
    expect(rec?.querySelector('.cpl-st--recruit')?.textContent).toContain('招募中');

    const warm = document.querySelector('[data-cid="warm_cup"]');
    expect(warm?.querySelector('.cpl-line')?.textContent).toBe('距開賽 3 天');
    expect(warm?.querySelector('.cpl-line--hl')).toBeTruthy();
    expect(warm?.querySelector('.cpl-chip--cup')?.textContent).toBe('盃賽');

    const live = document.querySelector('[data-cid="live_fr"]');
    expect(live?.querySelector('.cpl-st--live')?.textContent).toContain('進行中');
    expect(live?.querySelector('.cpl-line')).toBeNull();
    expect(live?.querySelector('img')).toBeNull();
    expect(screen.getByText('只屬於我')).toBeTruthy();
    expect(screen.getByRole('button', { name: '建立賽事' })).toBeTruthy();

    const reads = repo.calls().slice();
    expect(reads).toEqual(['getLaunch', 'listMine', 'listPublic']);

    await chooseStatus('warm');
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="live_fr"]')).toBeNull();

    await chooseStatus('done');
    const done = document.querySelector('[data-cid="done_lg"]');
    expect(done?.classList.contains('ended')).toBe(true);
    expect(done?.querySelector('.cpl-st--done')?.textContent).toContain('已結束');
    expect(done?.querySelector('.cpl-line')).toBeNull();
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeNull();

    await chooseStatus('all');
    expect(document.querySelector('[data-cid="done_lg"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="mine_only"]')).toBeTruthy();

    await chooseStatus('open');
    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    expect(screen.getByText('只屬於我')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="cup" />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="mine_only"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="live_fr"]')).toBeNull();
    expect(repo.calls()).toEqual(reads);
  });
});
