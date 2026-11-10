import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./update-prompt-fx', () => {
  throw new Error('ios chunk failed');
});

import { _resetReloadSafetyForTest, showSwReloadPrompt } from './reload-safety';

describe('showSwReloadPrompt 特效載入失敗', () => {
  afterEach(() => {
    _resetReloadSafetyForTest();
    document.body.innerHTML = '';
  });

  it('import 失敗時退回舊外觀，卡片仍在、按鈕仍可用', async () => {
    const reload = vi.fn();
    showSwReloadPrompt(reload, 'unsafe-page');
    const prompt = document.getElementById('sw-reload-deferred-prompt');
    expect(prompt).toBeTruthy();
    expect(prompt?.style.opacity).toBe('0');
    expect(prompt?.textContent).toContain('有新版本可用');
    expect(prompt?.textContent).toContain('完成目前操作後會自動更新。');

    await vi.waitFor(() => {
      expect(prompt?.style.opacity).toBe('1');
    });

    expect(prompt?.classList.contains('sw-reload-fx')).toBe(false);
    expect(prompt?.querySelector('svg.orbit')).toBeNull();
    expect(prompt?.style.background).toBe('rgb(17, 24, 39)');
    expect(prompt?.style.cssText).toContain('32px');
    expect(document.querySelector('style[data-sw-reload-fx-instance]')).toBeNull();

    (prompt?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });

  it('import 失敗時點「稍後」仍可關掉', async () => {
    showSwReloadPrompt(vi.fn(), 'modal-open');
    const prompt = document.getElementById('sw-reload-deferred-prompt');
    await vi.waitFor(() => {
      expect(prompt?.style.opacity).toBe('1');
    });
    (prompt?.querySelector('[data-sw-reload-later]') as HTMLButtonElement).click();
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });
});
