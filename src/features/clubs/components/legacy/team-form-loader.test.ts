import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./TeamFormModal');
  vi.resetModules();
});

describe('team-form-loader', () => {
  it('同一時間多次呼叫只會動態載入一次表單模組（共用 Promise）', async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock('./TeamFormModal', () => {
      loads += 1;
      return { TeamFormModal: () => null };
    });
    const mod = await import('./team-form-loader');
    const [a, b] = await Promise.all([mod.loadTeamFormModal(), mod.loadTeamFormModal()]);
    expect(a).toBe(b);
    await mod.loadTeamFormModal();
    expect(loads).toBe(1);
  });

  it('載入失敗後會清掉快取，下一次呼叫重新載入（L-08）', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('./TeamFormModal', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk load failed');
      return { TeamFormModal: () => null };
    });
    const mod = await import('./team-form-loader');
    await expect(mod.loadTeamFormModal()).rejects.toThrow();
    await expect(mod.loadTeamFormModal()).resolves.toBeTypeOf('function');
    expect(attempts).toBe(2);
  });
});
