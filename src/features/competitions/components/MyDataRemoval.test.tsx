// 「只看我的」清單最下方的移除我的賽事資料（設計 §4.11）。移除動作用替身，不連 Functions。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { getToasts, toast } from '@/ui/Toast';
import { CpCallError, type CpDataRemovalResult } from '../data/cp-callables';
import type { CpMineItem } from '../data/types';
import { CpEnvProvider } from '../env';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { NOW, competition, idleActions, memberActor } from '../testing/screen-fixtures';
import { InAppSection } from './InAppSection';
import { removalDoneText } from './MyDataRemoval';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  _resetAppConfirmForTest();
  toast.clear();
});

const LINK = '移除我的賽事資料';
const MINE: CpMineItem[] = [
  { id: 'cup_a', cid: 'cup_a', roles: ['player'], host: false, name: '示範盃', category: 'cup' },
  { id: 'lg_b', cid: 'lg_b', roles: ['rep'], host: false, name: '示範聯賽', category: 'league' },
];

function draw(requestMyDataRemoval: () => Promise<CpDataRemovalResult>, mine: CpMineItem[] = MINE) {
  let removed = false;
  const repo = createFakeCpRepo({
    launch: { isPublic: true, bannedWords: [] },
    mine: { uid_member: mine },
    competitions: [competition({ id: 'pub_c', name: '公開友誼賽', category: 'friendly', hostType: 'personal', hostTeamId: null })],
  });
  const listMine = repo.listMine.bind(repo);
  repo.listMine = vi.fn(async (uid: string) => (removed ? [] : listMine(uid)));
  const spy = vi.fn(async () => {
    const result = await requestMyDataRemoval();
    if (result.status === 'done') removed = true;
    return result;
  });
  render(
    <LocationProvider>
      <CpEnvProvider value={{ actor: memberActor, repo, actions: { ...idleActions(), requestMyDataRemoval: spy }, now: NOW }}>
        <InAppSection />
      </CpEnvProvider>
      <AppConfirmHost />
    </LocationProvider>,
  );
  return { repo, spy };
}

async function onlyMine(): Promise<void> {
  expect(await screen.findByText('公開友誼賽')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('checkbox'));
  });
}

async function openAndConfirm(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: LINK }));
  fireEvent.click(await screen.findByRole('button', { name: '繼續' }));
  return screen.findByRole('alertdialog');
}

const lastToast = () => getToasts().at(-1)?.message;

describe('移除我的賽事資料：入口位置', () => {
  it('沒開「只看我的」不畫；打開後清單最下方一行連結', async () => {
    draw(async () => ({ status: 'done', processed: 2, waiting: [] }));
    expect(await screen.findByText('公開友誼賽')).toBeTruthy();
    expect(screen.queryByRole('button', { name: LINK })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    const link = screen.getByRole('button', { name: LINK });
    expect(link.className).toBe('cp3-textlink');
    // 空狀態那一行（cpl-xmsg）不會因此多出來被誤認
    expect(document.querySelectorAll('.cpl-xmsg:not([data-cp-removal])')).toHaveLength(0);
    // 在清單（最後一張卡）之後
    const cards = document.querySelectorAll('[data-cid]');
    expect(cards).toHaveLength(2);
    expect(cards[cards.length - 1]!.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('只看我的清單是空的：不畫連結', async () => {
    draw(async () => ({ status: 'done', processed: 0, waiting: [] }), []);
    await onlyMine();
    expect(document.querySelectorAll('[data-cid]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: LINK })).toBeNull();
  });
});

describe('移除我的賽事資料：流程', () => {
  it('說明面板三行 → 繼續 → 確認框取消不送；再確認才送一次（confirm 由 callable 帶），done 提示並重讀清單', async () => {
    const { repo, spy } = draw(async () => ({ status: 'done', processed: 2, waiting: [] }));
    await onlyMine();
    fireEvent.click(screen.getByRole('button', { name: LINK }));
    const sheet = await screen.findByRole('dialog', { name: LINK });
    expect([...sheet.querySelectorAll('[data-cp-removal-lines] p')].map((li) => li.textContent)).toEqual([
      '報名中的名單：直接把你從隊伍移除。',
      '已開賽的賽事：名字改成『球員』或『成員』，\n比分和比賽紀錄會保留。',
      '目前還在擔任記分員的賽事，\n結束後才會完全移除。',
    ]);
    expect(within(sheet).getByRole('button', { name: '取消' })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: '繼續' }));
    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toContain('移除後無法復原，確定要移除嗎？');
    const askButtons = within(ask).getAllByRole('button');
    expect(askButtons.at(-1)!.textContent).toBe('移除');
    fireEvent.click(askButtons[0]!);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(spy).not.toHaveBeenCalled();
    // 取消確認後說明面板還在
    expect(screen.getByRole('dialog', { name: LINK })).toBeTruthy();

    const reads = (repo.listMine as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(within(screen.getByRole('dialog', { name: LINK })).getByRole('button', { name: '繼續' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getAllByRole('button').at(-1)!);
    await waitFor(() => expect(lastToast()).toBe('已移除你的賽事資料'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: LINK })).toBeNull());
    // 清單重新讀取：我的賽事都移除了，只看我的變空、連結也不畫
    expect((repo.listMine as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads + 1);
    await waitFor(() => expect(document.querySelectorAll('[data-cid]')).toHaveLength(0));
    expect(screen.queryByRole('button', { name: LINK })).toBeNull();
  });

  it('處理中：鈕轉圈寫「處理中…」、不可重按，只送一次', async () => {
    let finish: (value: CpDataRemovalResult) => void = () => {};
    const { spy } = draw(() => new Promise<CpDataRemovalResult>((resolve) => { finish = resolve; }));
    await onlyMine();
    fireEvent.click(within(await openAndConfirm()).getAllByRole('button').at(-1)!);
    const busy = await screen.findByRole('button', { name: '處理中…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.querySelector('.ui-button__spinner')).not.toBeNull();
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () => {
      finish({ status: 'done', processed: 1, waiting: [] });
    });
    await waitFor(() => expect(lastToast()).toBe('已移除你的賽事資料'));
  });

  it('waiting：N＝不同賽事的場數（3 筆 2 場），面板關閉、清單照樣重讀', async () => {
    const { repo } = draw(async () => ({
      status: 'waiting',
      processed: 1,
      waiting: [
        { cid: 'lg_b', reason: 'STAFF_ACTIVE' },
        { cid: 'lg_b', reason: 'NOT_ENDED' },
        { cid: 'cup_a', reason: 'NOT_ENDED' },
      ],
    }));
    await onlyMine();
    const reads = (repo.listMine as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(within(await openAndConfirm()).getAllByRole('button').at(-1)!);
    await waitFor(() => expect(lastToast()).toBe('已移除大部分資料，\n其餘 2 場會在賽事結束或指派到期後自動處理'));
    await waitFor(() => expect((repo.listMine as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads + 1));
    expect(screen.queryByRole('dialog', { name: LINK })).toBeNull();
  });

  it('REMOVAL_RATE_LIMITED：提示「剛剛已送出，請稍後再試」，不重讀清單', async () => {
    const { repo, spy } = draw(async () => { throw new CpCallError('REMOVAL_RATE_LIMITED', {}); });
    await onlyMine();
    const reads = (repo.listMine as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(within(await openAndConfirm()).getAllByRole('button').at(-1)!);
    await waitFor(() => expect(lastToast()).toBe('剛剛已送出，請稍後再試'));
    expect(getToasts().at(-1)?.tone).toBe('error');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((repo.listMine as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads);
    // 連結還在，可以稍後再點
    expect(screen.getByRole('button', { name: LINK })).toBeTruthy();
  });

  it('其他錯誤（SIGN_IN_REQUIRED、CONFIRM_REQUIRED）不露代碼，用通用失敗句', async () => {
    draw(async () => { throw new CpCallError('SIGN_IN_REQUIRED', {}); });
    await onlyMine();
    fireEvent.click(within(await openAndConfirm()).getAllByRole('button').at(-1)!);
    await waitFor(() => expect(lastToast()).toBe('操作失敗，請稍後再試'));
  });
});

describe('removalDoneText', () => {
  it('partial 而 waiting 是空的：不寫「其餘 0 場」', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    expect(removalDoneText(ct, { status: 'partial', processed: 5, waiting: [] })).toBe('已移除大部分資料，\n其餘會在賽事結束或指派到期後自動處理');
    expect(removalDoneText(ct, { status: 'partial', processed: 5, waiting: [{ cid: 'a', reason: 'x' }] })).toBe('已移除大部分資料，\n其餘 1 場會在賽事結束或指派到期後自動處理');
    expect(removalDoneText(ct, { status: 'done', processed: 5, waiting: [] })).toBe('已移除你的賽事資料');
  });
});
