import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@/features/events/components/EventFormModal');
  vi.resetModules();
});

describe('event-form-loader', () => {
  it('同一時間多次呼叫只會動態載入一次表單模組（共用 Promise）', async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock('@/features/events/components/EventFormModal', () => {
      loads += 1;
      return { EventFormModal: () => null };
    });
    const mod = await import('./event-form-loader');
    const [a, b] = await Promise.all([mod.loadEventFormModal(), mod.loadEventFormModal()]);
    expect(a).toBe(b);
    await mod.loadEventFormModal();
    expect(loads).toBe(1);
  });

  it('載入失敗後會清掉快取，下一次呼叫重新載入（L-08）', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('@/features/events/components/EventFormModal', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk load failed');
      return { EventFormModal: () => null };
    });
    const mod = await import('./event-form-loader');
    await expect(mod.loadEventFormModal()).rejects.toThrow();
    await expect(mod.loadEventFormModal()).resolves.toBeTypeOf('function');
    expect(attempts).toBe(2);
  });

  it('空閒預載：沒有 requestIdleCallback 時 2 秒後才載入，取消後不載入', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    let loads = 0;
    vi.doMock('@/features/events/components/EventFormModal', () => {
      loads += 1;
      return { EventFormModal: () => null };
    });
    const mod = await import('./event-form-loader');

    const cancelled = mod.scheduleEventFormPrefetch();
    cancelled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(loads).toBe(0);

    mod.scheduleEventFormPrefetch();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(loads).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(loads).toBe(1);
    vi.useRealTimers();
  });
});
