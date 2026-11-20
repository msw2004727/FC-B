import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import {
  s4Match,
  S4_SCENE_CAP,
  S4_SCENE_LIVE,
  S4_SCENE_PAUSED,
  S4_SCENE_PK,
  S4_SCENE_TAKEOVER,
  S4_SCENE_TIMEOUT,
} from '../testing/step4-fixtures';
import { LIVE_COPY } from './copy';
import { ScorePad, type ScoreFeedRow } from './ScorePad';
import { splitTeamName, TeamLockup } from './TeamLockup';

installUi4TestLocale();

afterEach(() => cleanup());

const pkRow = (key: string, side: 'home' | 'away', voided = false): ScoreFeedRow => ({
  key,
  seq: -1,
  pending: true,
  text: key,
  label: key,
  kind: 'pk',
  secondYellow: false,
  pkScored: true,
  voided,
  side,
});

describe('記分頁上方記分板（施工-第2批 卡 2-2）', () => {
  it('PK：上排比分拆三格、下排 PK 比分、不畫時鐘與節次、右邊第幾輪；非 PK 不拆', () => {
    const view = render(<ScorePad {...S4_SCENE_PK} />);
    const top = view.container.querySelector('.s4-top')!;
    expect(top.className.split(' ')[0]).toBe('s4-top');
    expect(top.classList.contains('s4-top--pk')).toBe(true);
    const score = top.querySelector('.s4-score')!;
    expect(score.children).toHaveLength(3);
    expect(score.textContent).toBe('2:2');
    expect(top.querySelector('.s4-scoreline .s4-pk')).toBeNull();
    expect(top.querySelector('.s4-clockrow > .s4-pk .s4-pk__tag')?.textContent).toBe('PK');
    expect(top.querySelector('.s4-clock')).toBeNull();
    expect(top.querySelector('.s4-stage')).toBeNull();
    expect(top.querySelector('.s4-round')?.textContent).toBe('第4輪');
    cleanup();

    const live = render(<ScorePad {...S4_SCENE_LIVE} />);
    const liveScore = live.container.querySelector('.s4-top .s4-score')!;
    expect(liveScore.children).toHaveLength(0);
    expect(live.container.querySelector('.s4-top')?.classList.contains('s4-top--pk')).toBe(false);
    expect(live.container.querySelector('.s4-round')).toBeNull();
  });

  it('PK 輪次用畫面上那一份事件列（含待送、不算作廢）', () => {
    const feed = [pkRow('a', 'home'), pkRow('b', 'away'), pkRow('c', 'home'), pkRow('d', 'away', true)];
    render(<ScorePad {...S4_SCENE_PK} feed={feed} />);
    expect(document.querySelector('.s4-round')?.textContent).toBe('第2輪');
  });

  it('停錶時節次與「已停錶」在同一格，頂部帶記號；板子不多一列', () => {
    const view = render(<ScorePad {...S4_SCENE_PAUSED} />);
    const top = view.container.querySelector('.s4-top')!;
    expect(top.classList.contains('s4-top--held')).toBe(true);
    const cell = top.querySelector('.s4-clockrow > .s4-stagecell')!;
    expect(cell.querySelector('.s4-stage')).toBeTruthy();
    expect(cell.querySelector('.s4-hold')?.textContent).toBe('已停錶 01:23');
    expect([...top.children].map((node) => node.className)).toEqual(['s4-board', 's4-clockrow']);
    cleanup();
    render(<ScorePad {...S4_SCENE_LIVE} />);
    expect(document.querySelector('.s4-top')?.classList.contains('s4-top--held')).toBe(false);
  });

  it('連線指示是記分頁自己的標記，長相跟著 data-link', () => {
    const view = render(<ScorePad {...S4_SCENE_LIVE} />);
    expect(view.container.querySelector('.s4-top .ui-badge')).toBeNull();
    expect(view.container.querySelector('.s4-link')?.getAttribute('data-link')).toBe('on');
    expect(view.container.querySelector('.s4-link')?.textContent).toBe(LIVE_COPY.connected);
    cleanup();
    render(<ScorePad {...S4_SCENE_LIVE} link={{ online: false, pendingCount: 3, storageUnavailable: false, wakeLock: true }} />);
    expect(document.querySelector('.s4-link')?.getAttribute('data-link')).toBe('off');
    expect(document.querySelector('.s4-link')?.textContent).toBe('離線・3 筆待送');
  });

  it('紀錄列照主客隊帶記號；正式頁的列沒有 side 時維持中性', () => {
    const view = render(<ScorePad {...S4_SCENE_LIVE} />);
    const rows = [...view.container.querySelectorAll('.s4-feed .s4-ev')];
    expect(rows.length).toBeGreaterThan(0);
    for (const li of rows) {
      expect(li.className.split(' ')[0]).toBe('s4-ev');
      expect(li.classList.contains('s4-ev--home') || li.classList.contains('s4-ev--away')).toBe(true);
    }
    cleanup();
    const feed: ScoreFeedRow[] = [
      { ...pkRow('x', 'away'), kind: 'goal', pkScored: undefined },
      { key: 'y', seq: 3, pending: false, text: 'y', label: 'y', kind: 'goal', secondYellow: false, voided: false },
    ];
    render(<ScorePad {...S4_SCENE_LIVE} feed={feed} />);
    const li = [...document.querySelectorAll('.s4-feed .s4-ev')];
    expect(li[0]?.classList.contains('s4-ev--away')).toBe(true);
    expect(li[1]?.className).toBe('s4-ev');
  });

  it('球隊暫停條帶喊暫停的那一隊', () => {
    render(<ScorePad {...S4_SCENE_TIMEOUT} />);
    const bar = document.querySelector('.s4-timeout')!;
    expect(bar.className.split(' ')[0]).toBe('s4-timeout');
    expect(bar.classList.contains('s4-timeout--home') || bar.classList.contains('s4-timeout--away')).toBe(true);
  });

  it('錶停著時「繼續計時」帶記號，走著時沒有', () => {
    render(<ScorePad {...S4_SCENE_PAUSED} />);
    expect(screen.getByRole('button', { name: '繼續計時' }).classList.contains('s4-resume')).toBe(true);
    cleanup();
    render(<ScorePad {...S4_SCENE_LIVE} />);
    expect(document.querySelector('.s4-resume')).toBeNull();
  });

  it('整區不能按的原因與接手鈕在紀錄區與按鈕區之間，不在提示區、不在紀錄區', () => {
    const view = render(
      <ScorePad {...S4_SCENE_TAKEOVER} match={s4Match({ rev: 192, resetRev: 0 })} eventCount={192} topBanner="這場已在另一個分頁記分" />,
    );
    const order = [...view.container.querySelector('.s4-root')!.children].map((node) => node.className.split(' ')[0]);
    expect(order.indexOf('s4-block')).toBe(order.indexOf('s4-feed') + 1);
    expect(order.indexOf('s4-pad')).toBe(order.indexOf('s4-block') + 1);
    const block = view.container.querySelector('.s4-block')!;
    expect([...block.children].map((node) => (node.textContent || '').trim())).toEqual([
      '這場已在另一個分頁記分',
      LIVE_COPY.atCap,
      LIVE_COPY.takeoverEntry,
    ]);
    expect([...block.querySelectorAll('p')].every((p) => p.getAttribute('role') === 'status')).toBe(true);
    expect(view.container.querySelector('.s4-alerts')?.textContent ?? '').not.toContain('另一個分頁');
    expect(view.container.querySelector('.s4-alerts')?.textContent ?? '').not.toContain(LIVE_COPY.atCap);
    expect(view.container.querySelector('.s4-extra')).toBeNull();
    expect(view.container.querySelector('.s4-pad .s4-block')).toBeNull();
    cleanup();

    const cap = render(<ScorePad {...S4_SCENE_CAP} />);
    expect(cap.container.querySelector('.s4-block')?.textContent).toBe(LIVE_COPY.atCap);
    cleanup();
    const live = render(<ScorePad {...S4_SCENE_LIVE} />);
    expect(live.container.querySelector('.s4-block')).toBeNull();
  });
});

describe('長隊名拆段（3.5）', () => {
  it('不傳 split 時隊名節點沒有子元素（觀眾頁輸出不變）；傳了 textContent 不變', () => {
    const name = '台北市信義區青年足球聯隊';
    const plain = render(<TeamLockup entryId="en_x" name={name} crests={[]} align="home" place="board" />);
    const plainName = plain.container.querySelector('.s4-team')!;
    expect(plainName.children).toHaveLength(0);
    expect(plainName.textContent).toBe(name);
    cleanup();
    const split = render(<TeamLockup entryId="en_x" name={name} crests={[]} align="home" place="board" split />);
    const splitName = split.container.querySelector('.s4-team')!;
    expect(splitName.children).toHaveLength(2);
    expect(splitName.textContent).toBe(name);
  });

  it('板上 7 以上對半拆、標籤最後四個字是後段、超過 10 個字標籤降字級', () => {
    expect(splitTeamName('雷霆隊', 'board')).toBeNull();
    expect(splitTeamName('台北青年足球隊', 'board')).toEqual(['台北青年', '足球隊']);
    // 半形字算 0.5：12 個英文字母＝6，不拆
    expect(splitTeamName('ABCDEFGHIJKL', 'board')).toBeNull();
    expect(splitTeamName('台北市信義區青年足球聯隊', 'column')).toEqual(['台北市信義區青年', '足球聯隊']);
    expect(splitTeamName('雷霆隊', 'column')).toBeNull();
    render(<TeamLockup entryId="en_x" name="台北市信義區青年足球聯隊" crests={[]} align="home" place="column" split />);
    expect(document.querySelector('.s4-col__name')?.classList.contains('s4-nm--long')).toBe(true);
  });
});
