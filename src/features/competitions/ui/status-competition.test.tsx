import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import { DELETE_ARM_MS } from './delete-competition';
import { StatusCompetitionEntry } from './status-competition';

const ct = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${JSON.stringify(p)}` : k);

type SetStatus = CpActions['setCompetitionStatus'];

function makeActions(): { setCompetitionStatus: ReturnType<typeof vi.fn<SetStatus>> } {
  return { setCompetitionStatus: vi.fn<SetStatus>().mockResolvedValue(undefined) };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StatusCompetitionEntry', () => {
  it('published：入口文字 statusEntry；選項 statusPostpone／statusCancel；沒有 statusResume；statusOk 停用', () => {
    const actions = makeActions();
    const onDone = vi.fn();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={onDone} />);
    expect(screen.getByText('statusEntry')).toBeTruthy();
    fireEvent.click(screen.getByText('statusEntry'));
    expect(screen.getByText('statusPostpone')).toBeTruthy();
    expect(screen.getByText('statusCancel')).toBeTruthy();
    expect(screen.queryByText('statusResume')).toBeNull();
    const ok = screen.getByText('statusOk').closest('button') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
  });

  it('postponed：入口文字 statusEntryResume；選項 statusResume／statusCancel', () => {
    const actions = makeActions();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="postponed" actions={actions} onDone={vi.fn()} />);
    expect(screen.getByText('statusEntryResume')).toBeTruthy();
    fireEvent.click(screen.getByText('statusEntryResume'));
    expect(screen.getByText('statusResume')).toBeTruthy();
    expect(screen.getByText('statusCancel')).toBeTruthy();
  });
});

describe('StatusCompetitionDialog 延期', () => {
  it('原因太短顯示 FIELD_LENGTH 且不送出；補足後送出 postponed', async () => {
    const actions = makeActions();
    const onDone = vi.fn();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={onDone} />);
    fireEvent.click(screen.getByText('statusEntry'));
    fireEvent.click(screen.getByText('statusPostpone'));
    expect(screen.getByText('statusReason')).toBeTruthy();
    const textarea = screen.getByRole('textbox');
    fireEvent.input(textarea, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('statusPostponeOk').closest('button')!);
    await flush();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('FIELD_LENGTH');
    expect(actions.setCompetitionStatus).not.toHaveBeenCalled();

    fireEvent.input(textarea, { target: { value: '場地整修' } });
    fireEvent.click(screen.getByText('statusPostponeOk').closest('button')!);
    await flush();
    expect(actions.setCompetitionStatus).toHaveBeenCalledWith({ cid: 'cup', status: 'postponed', reason: '場地整修' });
    expect(onDone).toHaveBeenCalledWith({ status: 'postponed', statusReason: '場地整修' });
  });
});

describe('StatusCompetitionDialog 恢復', () => {
  it('published 不帶 reason 鍵，onDone.statusReason 為 null', async () => {
    const actions = makeActions();
    const onDone = vi.fn();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="postponed" actions={actions} onDone={onDone} />);
    fireEvent.click(screen.getByText('statusEntryResume'));
    fireEvent.click(screen.getByText('statusResume'));
    expect(screen.queryByText('statusReason')).toBeNull();
    fireEvent.click(screen.getByText('statusResumeOk').closest('button')!);
    await flush();
    expect(actions.setCompetitionStatus).toHaveBeenCalledTimes(1);
    const arg = actions.setCompetitionStatus.mock.calls[0]?.[0] ?? {};
    expect(arg).toEqual({ cid: 'cup', status: 'published' });
    expect('reason' in arg).toBe(false);
    expect(onDone).toHaveBeenCalledWith({ status: 'published', statusReason: null });
  });
});

describe('StatusCompetitionDialog 取消', () => {
  it('需勾選並等 0.6 秒；送出 cancelled', async () => {
    const actions = makeActions();
    const onDone = vi.fn();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={onDone} />);
    fireEvent.click(screen.getByText('statusEntry'));
    fireEvent.click(screen.getByText('statusCancel'));
    expect(screen.getByText('statusCancelWarn')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const btn = screen.getByText('statusCancelOk').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(checkbox);
    await flush();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('data-confirm-armed')).toBe('false');
    await advance(DELETE_ARM_MS);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('data-confirm-armed')).toBe('true');
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '現場事故' } });
    fireEvent.click(btn);
    await flush();
    expect(actions.setCompetitionStatus).toHaveBeenCalledWith({ cid: 'cup', status: 'cancelled', reason: '現場事故' });
  });

  it('取消改選延期再改回取消：勾選狀態被清掉', async () => {
    const actions = makeActions();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('statusEntry'));
    fireEvent.click(screen.getByText('statusCancel'));
    const first = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(first);
    await flush();
    expect(first.checked).toBe(true);
    fireEvent.click(screen.getByText('statusPostpone'));
    fireEvent.click(screen.getByText('statusCancel'));
    const again = screen.getByRole('checkbox') as HTMLInputElement;
    expect(again.checked).toBe(false);
  });
});

describe('StatusCompetitionDialog 防連點', () => {
  it('actions 未 resolve 時按兩次只呼叫一次', async () => {
    const never = new Promise<unknown>(() => undefined);
    const actions = { setCompetitionStatus: vi.fn().mockReturnValue(never) };
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('statusEntry'));
    fireEvent.click(screen.getByText('statusPostpone'));
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '場地整修' } });
    const btn = screen.getByText('statusPostponeOk').closest('button')!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(actions.setCompetitionStatus).toHaveBeenCalledTimes(1);
  });
});

describe('StatusCompetitionDialog 失敗', () => {
  it('CpCallError 顯示錯誤訊息含 STATUS_TRANSITION', async () => {
    const actions = {
      setCompetitionStatus: vi.fn().mockRejectedValue(new CpCallError('STATUS_TRANSITION', {})),
    };
    const onDone = vi.fn();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={onDone} />);
    fireEvent.click(screen.getByText('statusEntry'));
    fireEvent.click(screen.getByText('statusPostpone'));
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '場地整修' } });
    fireEvent.click(screen.getByText('statusPostponeOk').closest('button')!);
    await flush();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('STATUS_TRANSITION');
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('StatusCompetitionDialog 焦點', () => {
  it('打開時焦點在 back 鈕', async () => {
    const actions = makeActions();
    render(<StatusCompetitionEntry ct={ct} cid="cup" status="published" actions={actions} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('statusEntry'));
    await flush();
    expect(document.activeElement?.textContent).toBe('back');
  });
});
