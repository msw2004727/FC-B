import { beforeEach, describe, expect, it, vi } from 'vitest';

type CallablesModule = typeof import('./callables');

async function importCallables(): Promise<CallablesModule> {
  vi.resetModules();
  return await import('./callables');
}

describe('callFn in mock mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
  });

  it('使用已註冊的 mock', async () => {
    const { callFn, registerMock, clearMocks } = await importCallables();
    clearMocks();
    registerMock('registerForEvent', () => ({ success: true }));
    const res = await callFn('registerForEvent', { eventId: 'e1' } as never);
    expect(res).toMatchObject({ success: true });
  });

  it('未註冊的 mock 丟出 Error（含名稱）', async () => {
    const { callFn, clearMocks } = await importCallables();
    clearMocks();
    await expect(callFn('registerForEvent', { eventId: 'e1' } as never)).rejects.toThrow(
      /未註冊的 mock/,
    );
    await expect(callFn('registerForEvent', { eventId: 'e1' } as never)).rejects.toThrow(
      /registerForEvent/,
    );
  });

  it('mock 丟錯 → 轉成 CallableError', async () => {
    const { callFn, registerMock, clearMocks, CallableError } = await importCallables();
    clearMocks();
    registerMock('registerForEvent', () => {
      const err = new Error('boom') as Error & { code?: string; details?: unknown };
      err.code = 'internal';
      err.details = { reason: 'test' };
      throw err;
    });
    await expect(callFn('registerForEvent', { eventId: 'e1' } as never)).rejects.toBeInstanceOf(
      CallableError,
    );
    await expect(callFn('registerForEvent', { eventId: 'e1' } as never)).rejects.toMatchObject({
      code: 'internal',
      message: 'boom',
      details: { reason: 'test' },
    });
  });

  it('clearMocks 清空既有註冊', async () => {
    const { callFn, registerMock, clearMocks } = await importCallables();
    registerMock('writeAuditLog', () => ({ ok: true } as never));
    clearMocks();
    await expect(callFn('writeAuditLog', {} as never)).rejects.toThrow(/未註冊的 mock/);
  });
});

describe('Request recorder', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
  });

  it('記錄 mock 模式呼叫', async () => {
    const { callFn, registerMock, clearMocks, startRecording, stopRecording } =
      await importCallables();
    clearMocks();
    registerMock('registerForEvent', () => ({ success: true }));
    startRecording();
    await callFn('registerForEvent', { eventId: 'e1' } as never);
    await callFn('registerForEvent', { eventId: 'e2' } as never);
    const recorded = stopRecording();
    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.name).toBe('registerForEvent');
    expect(recorded[0]?.request).toEqual({ eventId: 'e1' });
    expect(recorded[1]?.request).toEqual({ eventId: 'e2' });
    expect(typeof recorded[0]?.at).toBe('number');
  });

  it('未 startRecording 時不記錄', async () => {
    const { callFn, registerMock, clearMocks, stopRecording } = await importCallables();
    clearMocks();
    registerMock('registerForEvent', () => ({ success: true }));
    await callFn('registerForEvent', { eventId: 'e1' } as never);
    const recorded = stopRecording();
    expect(recorded).toHaveLength(0);
  });

  it('未註冊的 mock 也先被 recorder 記錄', async () => {
    const { callFn, clearMocks, startRecording, stopRecording } = await importCallables();
    clearMocks();
    startRecording();
    await expect(callFn('registerForEvent', { eventId: 'e1' } as never)).rejects.toThrow();
    const recorded = stopRecording();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.name).toBe('registerForEvent');
  });
});
