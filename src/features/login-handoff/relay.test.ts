import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginRelay, _resetRelayForTest, type RelayInput } from './relay';
import { renderRelay, type RelayHandlers, type RelayView } from './view';

const callFn = vi.hoisted(() => vi.fn());

vi.mock('@/data/callables', () => ({ callFn }));

vi.mock('./view', () => ({
  renderWait: vi.fn(),
  renderRelay: vi.fn(),
}));

const HANDOFF_ID = 'ab'.repeat(32);

function input(overrides: Partial<RelayInput> = {}): RelayInput {
  return {
    handoffId: HANDOFF_ID,
    code: 'auth-code',
    liffClientId: '2008123456',
    liffRedirectUri: 'https://toosterx.com/events/e',
    ...overrides,
  };
}

function lastView(): RelayView | null | undefined {
  const calls = vi.mocked(renderRelay).mock.calls;
  return calls.at(-1)?.[0];
}

function pickOptions(): number[] {
  const view = lastView();
  if (view?.kind !== 'pick') throw new Error('expected pick');
  return [...view.options];
}

function handlers(): RelayHandlers {
  const found = vi.mocked(renderRelay).mock.calls.at(-1)?.[1];
  if (!found) throw new Error('no relay handlers');
  return found;
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  _resetRelayForTest();
  callFn.mockReset();
  vi.mocked(renderRelay).mockClear();
});

describe('relay', () => {
  it('liffRedirectUri 缺少 → wrong，不呼叫伺服器', async () => {
    await beginRelay(input({ liffRedirectUri: null }));
    expect(lastView()).toEqual({ kind: 'wrong' });
    expect(callFn).not.toHaveBeenCalled();
  });

  it.each([
    ['ok', { ok: true }, { kind: 'done' }],
    ['mismatch', { ok: false, reason: 'mismatch' }, { kind: 'wrong' }],
  ] as const)('%s 對應畫面', async (_label, body, view) => {
    callFn.mockResolvedValue(body);
    await beginRelay(input());
    const options = pickOptions();
    handlers().onPick(options[0] ?? 10);
    await flush();
    expect(lastView()).toEqual(view);
  });

  it('failed-precondition → 已送出或已失效', async () => {
    callFn.mockRejectedValue(codeError('functions/failed-precondition'));
    await beginRelay(input());
    const options = pickOptions();
    handlers().onPick(options[0] ?? 10);
    await flush();
    expect(lastView()).toEqual({ kind: 'sentOrExpired' });
  });

  it('resource-exhausted 留在選數字並可重試同一數字', async () => {
    let release: (() => void) | undefined;
    callFn.mockImplementation(() => new Promise((_resolve, reject) => {
      release = () => reject(codeError('functions/resource-exhausted'));
    }));
    await beginRelay(input());
    const options = pickOptions();
    const pick = options[0] ?? 10;
    handlers().onPick(pick);
    expect(lastView()).toMatchObject({ kind: 'pick', busy: true, tryLater: false, picked: pick });
    expect(callFn).toHaveBeenCalledTimes(1);
    handlers().onPick(options[1] ?? pick);
    expect(callFn).toHaveBeenCalledTimes(1);
    release?.();
    await flush();
    expect(lastView()).toMatchObject({ kind: 'pick', busy: false, tryLater: true, options });
    expect(callFn.mock.calls[0]?.[0]).toBe('lineLoginHandoff');
    expect(callFn.mock.calls[0]?.[1]).toMatchObject({ op: 'relay', pick: String(pick), handoffId: HANDOFF_ID });

    callFn.mockRejectedValueOnce(codeError('functions/unavailable'));
    handlers().onRetry();
    await flush();
    expect(callFn.mock.calls[1]?.[1]).toMatchObject({ pick: String(pick) });
    expect(lastView()).toMatchObject({ kind: 'pick', tryLater: true, busy: false });
  });

  it('無 code 的網路錯誤留在選數字，invalid-argument 是 wrong', async () => {
    callFn.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await beginRelay(input());
    const pick = pickOptions()[0] ?? 10;
    handlers().onPick(pick);
    await flush();
    expect(lastView()).toMatchObject({ kind: 'pick', tryLater: true });

    _resetRelayForTest();
    vi.mocked(renderRelay).mockClear();
    callFn.mockRejectedValueOnce(codeError('functions/invalid-argument'));
    await beginRelay(input());
    const again = pickOptions()[0] ?? 10;
    handlers().onPick(again);
    await flush();
    expect(lastView()).toEqual({ kind: 'wrong' });
  });

  it.each([
    'internal',
    'deadline-exceeded',
    'unknown',
  ])('%s → 稍後再試，重試沿用同一數字', async (name) => {
    callFn.mockRejectedValueOnce(codeError(`functions/${name}`));
    await beginRelay(input());
    const pick = pickOptions()[0] ?? 10;
    handlers().onPick(pick);
    await flush();
    expect(lastView()).toMatchObject({ kind: 'pick', busy: false, tryLater: true });
    expect(callFn.mock.calls[0]?.[1]).toMatchObject({ pick: String(pick) });

    callFn.mockRejectedValueOnce(codeError(`functions/${name}`));
    handlers().onRetry();
    await flush();
    expect(callFn.mock.calls[1]?.[1]).toMatchObject({ pick: String(pick) });
    expect(lastView()).toMatchObject({ kind: 'pick', tryLater: true, busy: false });
  });

  it('invalid-argument → wrong', async () => {
    callFn.mockRejectedValueOnce(codeError('invalid-argument'));
    await beginRelay(input());
    handlers().onPick(pickOptions()[0] ?? 10);
    await flush();
    expect(lastView()).toEqual({ kind: 'wrong' });
  });

  it('關閉不呼叫伺服器', async () => {
    await beginRelay(input());
    handlers().onClose();
    expect(lastView()).toBeNull();
    expect(callFn).not.toHaveBeenCalled();
  });
});
