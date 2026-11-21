// 建立賽事「取消」（站長 11-21）：三步底部都是「取消｜主鈕」；表單和進頁時不同才問「放棄建立？」，沒填過直接離開；
// 第 1 步左上返回同一條規則（第 2、3 步返回仍是回上一步）；建立、發布送出中取消與返回都停用。
// 離開走 CpFrame 同一個 useGoBack('/tournaments')：歷史起點時取代成 /tournaments。
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
const cancelBtn = () => screen.getAllByRole('button', { name: '取消' }).find((node) => node.closest('.cph-split')) as HTMLButtonElement;
const backBtn = () => screen.getByRole('button', { name: '返回' }) as HTMLButtonElement;
const dialog = () => screen.queryByRole('alertdialog');
const nameInput = () => document.getElementById('cpf-name') as HTMLInputElement;

async function press(node: HTMLElement): Promise<void> {
  fireEvent.click(node);
  await flush();
}

describe('建立賽事：三步都有取消', () => {
  it.each([
    ['wizard-1', '下一步'],
    ['wizard-2', '下一步'],
    ['wizard-3', '建立賽事'],
  ] as const)('%s：底部「取消｜%s」同一列，取消在左', (name, primary) => {
    draw(name);
    const row = cancelBtn().closest('.cph-split') as HTMLElement;
    const buttons = [...row.querySelectorAll('button')].map((node) => node.textContent);
    expect(buttons).toEqual(['取消', primary]);
  });
});

describe('建立賽事：取消', () => {
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

  it('第 2 步沒改（帶預填進來）直接離開；改了組別名稱才問', async () => {
    draw('wizard-2');
    await press(cancelBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');

    cleanup();
    history.replaceState(null, '', START);
    markHistoryRoot();
    draw('wizard-2');
    fireEvent.input(document.getElementById('cpf-d0-name')!, { target: { value: '青年組' } });
    await press(cancelBtn());
    expect(dialog()?.textContent).toContain(ASK);
    await press(document.getElementById('app-confirm-cancel')!);
    expect(location.pathname).toBe(START);
  });

  it('第 3 步沒改（帶預填進來）：直接離開', async () => {
    draw('wizard-3');
    await press(cancelBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe('/tournaments');
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
    fireEvent.input(document.getElementById('cpf-d0-name')!, { target: { value: '青年組' } });
    await press(backBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
  });
});

describe('建立賽事：送出中停用取消與返回', () => {
  it('建立中：取消、返回都停用，按了不離開也不問', async () => {
    draw('wizard-3', { actions: { create: vi.fn(() => new Promise<never>(() => {})) } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await flush();
    expect(cancelBtn().disabled).toBe(true);
    expect(backBtn().disabled).toBe(true);
    await press(cancelBtn());
    await press(backBtn());
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
  });

  it('按下建立同一刻按取消、返回（按鈕還沒重畫成停用）：不離開、不回上一步', async () => {
    draw('wizard-3', { actions: { create: vi.fn(() => new Promise<never>(() => {})) } });
    const cancel = cancelBtn();
    // 不經 act：兩下之間 Preact 還沒重畫，取消鈕仍是可按的舊畫面
    const click = () => new MouseEvent('click', { bubbles: true });
    screen.getByRole('button', { name: '建立賽事' }).dispatchEvent(click());
    expect(cancel.disabled).toBe(false);
    cancel.dispatchEvent(click());
    backBtn().dispatchEvent(click());
    await flush();
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe(START);
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
  });

  it('建立失敗恢復後：取消、返回又可按', async () => {
    let fail!: (err: Error) => void;
    draw('wizard-3', { actions: { create: vi.fn(() => new Promise<never>((_, reject) => { fail = reject; })) } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await flush();
    await act(async () => { fail(new Error('network')); await Promise.resolve(); });
    await flush();
    expect(cancelBtn().disabled).toBe(false);
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
