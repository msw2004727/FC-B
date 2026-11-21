// 建立賽事「取消」（站長 11-21）：第 1 步底部「取消｜下一步」；第 2、3 步底部「上一步｜主鈕」，按鈕列下方一行小字「取消建立」。
// 取消、取消建立、第 1 步左上返回同一條規則：表單和進頁時不同才問「放棄建立？」，沒填過直接離開；第 2、3 步返回與上一步回上一步。
// 建立、發布送出中：上一步、取消建立與返回都停用。離開走 CpFrame 同一個 useGoBack('/tournaments')：歷史起點時取代成 /tournaments。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { markHistoryRoot } from '@/core/back-guard';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { idleActions, screenEnv } from '../testing/screen-fixtures';
import NewCompetitionPage from './NewCompetitionPage';

const START = '/competitions/new';
const ASK = '已填的內容不會保存，確定放棄建立？';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  // 直開建賽頁（歷史起點）：返回取代成 /tournaments。
  history.replaceState(null, '', START);
  markHistoryRoot();
});

afterEach(() => {
  cleanup();
  _resetAppConfirmForTest();
  vi.useRealTimers();
});

type Screen = 'wizard-1' | 'wizard-2' | 'wizard-3';

function draw(name: Screen, opts: { blank?: boolean; actions?: Partial<CpInjectedEnv['actions']> } = {}) {
  const env = screenEnv(name, { ...idleActions(), ...opts.actions });
  // blank：正式頁進來的空白表單（不帶預填）
  const value: CpInjectedEnv = opts.blank ? { ...env, wizardSeed: undefined } : env;
  return render(
    <LocationProvider>
      <CpEnvProvider value={value}>
        <NewCompetitionPage />
      </CpEnvProvider>
      <AppConfirmHost />
    </LocationProvider>,
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const row = () => document.querySelector('.cph-split') as HTMLElement;
const rowButtons = () => [...row().querySelectorAll('button')];
/** 第 1 步底部的「取消」 */
const cancelBtn = () => rowButtons().find((node) => node.textContent === '取消') as HTMLButtonElement;
/** 第 2、3 步按鈕列下方的「取消建立」 */
const cancelLink = () => screen.getByRole('button', { name: '取消建立' }) as HTMLButtonElement;
const prevBtn = () => rowButtons().find((node) => node.textContent === '上一步') as HTMLButtonElement;
const backBtn = () => screen.getByRole('button', { name: '返回' }) as HTMLButtonElement;
const dialog = () => screen.queryByRole('alertdialog');
const nameInput = () => document.getElementById('cpf-name') as HTMLInputElement;
const editDivision = () => fireEvent.input(document.getElementById('cpf-d0-name')!, { target: { value: '青年組' } });

async function press(node: HTMLElement): Promise<void> {
  fireEvent.click(node);
  await flush();
}

function restart(): void {
  cleanup();
  history.replaceState(null, '', START);
  markHistoryRoot();
}

describe('建立賽事：三步的按鈕組合', () => {
  it('第 1 步：「取消｜下一步」，沒有小字取消', () => {
    draw('wizard-1');
    expect(rowButtons().map((node) => node.textContent)).toEqual(['取消', '下一步']);
    expect(screen.queryByRole('button', { name: '取消建立' })).toBeNull();
  });

  it.each([
    ['wizard-2', '下一步'],
    ['wizard-3', '建立賽事'],
  ] as const)('%s：「上一步｜%s」，按鈕列下方一行「取消建立」', (name, primary) => {
    draw(name);
    expect(rowButtons().map((node) => node.textContent)).toEqual(['上一步', primary]);
    expect(row().contains(cancelLink())).toBe(false);
    // 在按鈕列後面（下方）
    expect(row().compareDocumentPosition(cancelLink()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('建立賽事：第 1 步取消', () => {
  it('什麼都沒填：不問，直接離開到賽事列表', async () => {
    draw('wizard-1', { blank: true });
    await press(cancelBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');
  });

  it('改了又改回原值：視同沒填，直接離開', async () => {
    draw('wizard-1', { blank: true });
    fireEvent.input(nameInput(), { target: { value: '夏季盃' } });
    fireEvent.input(nameInput(), { target: { value: '' } });
    await press(cancelBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');
  });

  it('填過：跳確認；按取消留在原步驟、內容還在；再按取消、按放棄才離開', async () => {
    draw('wizard-1', { blank: true });
    fireEvent.input(nameInput(), { target: { value: '夏季盃' } });
    await press(cancelBtn());
    expect(dialog()?.textContent).toContain(ASK);
    expect(document.getElementById('app-confirm-ok')?.textContent).toBe('放棄');

    await press(document.getElementById('app-confirm-cancel')!);
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
    expect(nameInput().value).toBe('夏季盃');

    await press(cancelBtn());
    await press(document.getElementById('app-confirm-ok')!);
    expect(location.pathname).toBe('/tournaments');
  });
});

describe('建立賽事：第 2、3 步「取消建立」', () => {
  it('第 2 步沒改（帶預填進來）直接離開', async () => {
    draw('wizard-2');
    await press(cancelLink());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');
  });

  it('第 2 步改了組別名稱：先問；繼續填寫留在第 2 步、內容還在；放棄才離開', async () => {
    draw('wizard-2');
    editDivision();
    await press(cancelLink());
    expect(dialog()?.textContent).toContain(ASK);
    await press(document.getElementById('app-confirm-cancel')!);
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 2／3')).toBeTruthy();
    expect((document.getElementById('cpf-d0-name') as HTMLInputElement).value).toBe('青年組');
    await press(cancelLink());
    await press(document.getElementById('app-confirm-ok')!);
    expect(location.pathname).toBe('/tournaments');
  });

  it('第 3 步：沒改直接離開；前面改過才問', async () => {
    draw('wizard-3');
    await press(cancelLink());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');

    restart();
    draw('wizard-2');
    editDivision();
    await press(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
    await press(cancelLink());
    expect(dialog()?.textContent).toContain(ASK);
    await press(document.getElementById('app-confirm-cancel')!);
    expect(location.pathname).toBe(START);
  });

  it('底部上一步：改過也不問，回上一步', async () => {
    draw('wizard-2');
    editDivision();
    await press(prevBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
  });
});

describe('建立賽事：左上返回', () => {
  it('第 1 步沒填：直接離開', async () => {
    draw('wizard-1', { blank: true });
    await press(backBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');
  });

  it('第 1 步填過：先問；繼續填寫留在頁面，放棄才離開', async () => {
    draw('wizard-1', { blank: true });
    fireEvent.input(nameInput(), { target: { value: '夏季盃' } });
    await press(backBtn());
    expect(dialog()?.textContent).toContain(ASK);
    await press(document.getElementById('app-confirm-cancel')!);
    expect(location.pathname).toBe(START);
    expect(nameInput().value).toBe('夏季盃');
    await press(backBtn());
    await press(document.getElementById('app-confirm-ok')!);
    expect(location.pathname).toBe('/tournaments');
  });

  it('第 2 步：返回仍是回第 1 步，不問', async () => {
    draw('wizard-2');
    editDivision();
    await press(backBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
  });
});

describe('建立賽事：送出中停用上一步、取消建立與返回', () => {
  it('建立中：三顆都停用，按了不離開、不回上一步、不問', async () => {
    draw('wizard-3', { actions: { create: vi.fn(() => new Promise<never>(() => {})) } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await flush();
    expect(prevBtn().disabled).toBe(true);
    expect(cancelLink().disabled).toBe(true);
    expect(backBtn().disabled).toBe(true);
    await press(prevBtn());
    await press(cancelLink());
    await press(backBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
  });

  it('按下建立同一刻按上一步、取消建立、返回（按鈕還沒重畫成停用）：不離開、不回上一步', async () => {
    draw('wizard-3', { actions: { create: vi.fn(() => new Promise<never>(() => {})) } });
    const prev = prevBtn();
    const cancel = cancelLink();
    const back = backBtn();
    // 不經 act：幾下之間 Preact 還沒重畫，按鈕仍是可按的舊畫面
    const click = () => new MouseEvent('click', { bubbles: true });
    screen.getByRole('button', { name: '建立賽事' }).dispatchEvent(click());
    expect(cancel.disabled).toBe(false);
    prev.dispatchEvent(click());
    cancel.dispatchEvent(click());
    back.dispatchEvent(click());
    await flush();
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
  });

  it('建立失敗恢復後：三顆又可按', async () => {
    let fail!: (err: Error) => void;
    draw('wizard-3', { actions: { create: vi.fn(() => new Promise<never>((_, reject) => { fail = reject; })) } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await flush();
    await act(async () => { fail(new Error('network')); await Promise.resolve(); });
    await flush();
    expect(prevBtn().disabled).toBe(false);
    expect(cancelLink().disabled).toBe(false);
    expect(backBtn().disabled).toBe(false);
  });

  it('發布中：返回停用', async () => {
    draw('wizard-3', { actions: { publish: vi.fn(() => new Promise<never>(() => {})) } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await flush();
    expect(backBtn().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '發布' }));
    await flush();
    expect(backBtn().disabled).toBe(true);
    await press(backBtn());
    expect(location.pathname).toBe(START);
  });
});
