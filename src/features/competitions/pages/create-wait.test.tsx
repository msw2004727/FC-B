// 建立賽事、發布等待中：按鈕轉圈並停用、連按只送一次；等超過 2 秒才出現說明，超過 15 秒換一句；完成、失敗或卸載時計時器清掉（站長 11-21）。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { idleActions, screenEnv } from '../testing/screen-fixtures';
import NewCompetitionPage, { WAIT_HINT_MS, WAIT_LONG_MS } from './NewCompetitionPage';

const SLOW = '正在寫入資料，請稍候';
const LONG = '還在處理，請不要關閉頁面';

type Created = { cid: string; dvIds: string[] };

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function draw(screenName: 'wizard-3', actions: Partial<CpInjectedEnv['actions']>) {
  const env = screenEnv(screenName, { ...idleActions(), ...actions });
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <NewCompetitionPage />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

const hint = (): string | null => screen.queryByRole('status')?.textContent ?? null;
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const buttonNamed = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('建立賽事等待中', () => {
  it('按鈕停用、連按只送一次；2 秒前沒有字，2 秒後「正在寫入」，15 秒後換「還在處理」，完成後收掉', async () => {
    vi.useFakeTimers();
    let done!: (value: Created) => void;
    const create = vi.fn(() => new Promise<Created>((resolve) => { done = resolve; }));
    draw('wizard-3', { create });
    // 同一個 tick 連按兩下（按鈕還沒重畫成停用）：只送一次
    fireEvent.click(buttonNamed('建立賽事'));
    fireEvent.click(buttonNamed('建立賽事'));
    expect(create).toHaveBeenCalledTimes(1);
    await tick(0);
    expect(buttonNamed('建立賽事').disabled).toBe(true);
    fireEvent.click(buttonNamed('建立賽事'));
    expect(create).toHaveBeenCalledTimes(1);

    await tick(WAIT_HINT_MS - 1);
    expect(hint()).toBeNull();
    await tick(1);
    expect(hint()).toBe(SLOW);
    await tick(WAIT_LONG_MS - WAIT_HINT_MS - 1);
    expect(hint()).toBe(SLOW);
    await tick(1);
    expect(hint()).toBe(LONG);

    await act(async () => {
      done({ cid: 'cup', dvIds: ['dv_adult'] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hint()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('1 秒內完成：從頭到尾不出字，計時器清乾淨', async () => {
    vi.useFakeTimers();
    const create = vi.fn(() => new Promise<Created>((resolve) => { setTimeout(() => resolve({ cid: 'cup', dvIds: [] }), 900); }));
    draw('wizard-3', { create });
    fireEvent.click(buttonNamed('建立賽事'));
    await tick(899);
    expect(hint()).toBeNull();
    await tick(1);
    expect(buttonNamed('發布')).toBeTruthy(); // 已到建好草稿那一頁
    expect(hint()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await tick(WAIT_LONG_MS * 2);
    expect(hint()).toBeNull();
  });

  it('等待中離開頁面（卸載）：兩個計時器都清掉', async () => {
    vi.useFakeTimers();
    const view = draw('wizard-3', { create: vi.fn(() => new Promise<never>(() => {})) });
    fireEvent.click(buttonNamed('建立賽事'));
    await tick(0);
    expect(vi.getTimerCount()).toBe(2);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('失敗：說明收掉、按鈕恢復可按、計時器清掉', async () => {
    vi.useFakeTimers();
    let fail!: (err: Error) => void;
    const create = vi.fn(() => new Promise<never>((_, reject) => { fail = reject; }));
    draw('wizard-3', { create });
    fireEvent.click(buttonNamed('建立賽事'));
    await tick(WAIT_HINT_MS);
    expect(hint()).toBe(SLOW);
    await act(async () => {
      fail(new Error('network'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hint()).toBeNull();
    expect(buttonNamed('建立賽事').disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('發布等待中', () => {
  it('按鈕停用、連按只送一次；同樣 2 秒、15 秒兩段說明', async () => {
    vi.useFakeTimers();
    const publish = vi.fn(() => new Promise<never>(() => {}));
    // 先真的建好草稿（拿到 cid），發布鈕才會送
    draw('wizard-3', { publish });
    fireEvent.click(buttonNamed('建立賽事'));
    await tick(0);
    fireEvent.click(buttonNamed('發布'));
    fireEvent.click(buttonNamed('發布'));
    expect(publish).toHaveBeenCalledTimes(1);
    await tick(0);
    expect(buttonNamed('發布').disabled).toBe(true);
    expect(hint()).toBeNull();
    await tick(WAIT_HINT_MS);
    expect(hint()).toBe(SLOW);
    await tick(WAIT_LONG_MS - WAIT_HINT_MS);
    expect(hint()).toBe(LONG);
  });
});
