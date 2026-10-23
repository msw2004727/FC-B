import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const functionsHandle = { region: 'asia-east1' };

const { getFirebaseMock, shouldUseEmulatorMock, httpsCallableMock } = vi.hoisted(() => ({
  getFirebaseMock: vi.fn(),
  shouldUseEmulatorMock: vi.fn(() => false),
  httpsCallableMock: vi.fn(),
}));

vi.mock('./firebase', () => ({
  getFirebase: getFirebaseMock,
  shouldUseEmulator: shouldUseEmulatorMock,
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: httpsCallableMock,
}));

const QA_ERROR = '[auth] QA login failed';
const SECRET = 'pw-secret';

type CallablesModule = typeof import('./callables');

async function loadCallables(): Promise<CallablesModule> {
  vi.resetModules();
  return import('./callables');
}

function assertFixedQaError(err: unknown): void {
  expect(err).toBeInstanceOf(Error);
  const error = err as Error & { cause?: unknown; details?: unknown };
  expect(error.message).toBe(QA_ERROR);
  expect(error.message).not.toContain(SECRET);
  expect(error.stack ?? '').not.toContain(SECRET);
  expect(String(error.cause)).not.toContain(SECRET);
  expect(String(error)).not.toContain(SECRET);
  expect(error.details).toBeUndefined();
}

beforeEach(() => {
  vi.unstubAllEnvs();
  getFirebaseMock.mockReset();
  shouldUseEmulatorMock.mockReset();
  httpsCallableMock.mockReset();
  shouldUseEmulatorMock.mockReturnValue(false);
  getFirebaseMock.mockResolvedValue({ functions: functionsHandle });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('callFn issueQaTestToken', () => {
  it('mock 模式回傳註冊結果，且 recorder 不記這支也不含密碼', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    const { callFn, registerMock, clearMocks, startRecording, stopRecording } = await loadCallables();
    clearMocks();

    const mockResult = { customToken: 'mock-token-qa', agentId: 'agent-coach' };
    registerMock('issueQaTestToken', () => mockResult);
    registerMock('registerForEvent', () => ({ success: true }));

    const direct = await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' });
    expect(direct).toEqual(mockResult);

    startRecording();
    await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' });
    await callFn('registerForEvent', { eventId: 'e-control', participants: [] });
    const recorded = stopRecording();

    expect(recorded.map((entry) => entry.name)).toEqual(['registerForEvent']);
    expect(JSON.stringify(recorded)).not.toContain('issueQaTestToken');
    expect(JSON.stringify(recorded)).not.toContain(SECRET);
    expect(recorded[0]?.request).toEqual({ eventId: 'e-control', participants: [] });
  });

  it('mock handler 拋錯時改拋固定錯誤，訊息不含密碼', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    const { callFn, registerMock, clearMocks } = await loadCallables();
    clearMocks();
    registerMock('issueQaTestToken', () => {
      throw new Error(`contains ${SECRET}`);
    });

    const caught = await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' }).then(
      () => {
        throw new Error('應該拒絕');
      },
      (err: unknown) => err,
    );
    assertFixedQaError(caught);
  });

  it('未註冊 mock 時改拋固定錯誤', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    const { callFn, clearMocks } = await loadCallables();
    clearMocks();

    const caught = await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' }).then(
      () => {
        throw new Error('應該拒絕');
      },
      (err: unknown) => err,
    );
    assertFixedQaError(caught);
  });

  it('非 mock、非 emulator 時以 ctx.functions 呼叫 httpsCallable 並回傳 data', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'live');
    shouldUseEmulatorMock.mockReturnValue(false);
    const callable = vi.fn(async () => ({ data: { customToken: 'server-token' } }));
    httpsCallableMock.mockReturnValue(callable);

    const { callFn } = await loadCallables();
    const result = await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' });

    expect(result).toEqual({ customToken: 'server-token' });
    expect(httpsCallableMock).toHaveBeenCalledTimes(1);
    expect(httpsCallableMock).toHaveBeenCalledWith(functionsHandle, 'issueQaTestToken');
    expect(callable).toHaveBeenCalledWith({ password: SECRET, persona: 'coach' });
  });

  it('httpsCallable 拒絕時改拋固定錯誤，不帶出 details', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'live');
    shouldUseEmulatorMock.mockReturnValue(false);
    const callable = vi.fn(async () => {
      const error = new Error(`upstream ${SECRET}`) as Error & { details?: unknown };
      error.details = { password: SECRET };
      throw error;
    });
    httpsCallableMock.mockReturnValue(callable);

    const { callFn } = await loadCallables();
    const caught = await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' }).then(
      () => {
        throw new Error('應該拒絕');
      },
      (err: unknown) => err,
    );
    assertFixedQaError(caught);
  });

  it('emulator 模式下 QA 路徑仍走 ctx.functions，一般 callable 仍被禁止', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'live');
    shouldUseEmulatorMock.mockReturnValue(true);
    const callable = vi.fn(async () => ({ data: { customToken: 'emulator-token' } }));
    httpsCallableMock.mockReturnValue(callable);

    const { callFn } = await loadCallables();
    const result = await callFn('issueQaTestToken', { password: SECRET, persona: 'coach' });
    expect(result).toEqual({ customToken: 'emulator-token' });
    expect(httpsCallableMock).toHaveBeenCalledWith(functionsHandle, 'issueQaTestToken');

    const callsAfterQa = httpsCallableMock.mock.calls.length;
    await expect(
      callFn('registerForEvent', { eventId: 'e-emulator', participants: [] }),
    ).rejects.toThrow(/emulator 模式下禁止呼叫/);
    expect(httpsCallableMock.mock.calls.length).toBe(callsAfterQa);
  });
});
