import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./update-prompt-fx', () => {
  throw new Error('ios chunk failed');
});

import { setLocale } from '@/i18n/i18n';
import { UPDATE_PROMPT_OPEN_CLASS, _resetReloadSafetyForTest, showSwReloadPrompt } from './reload-safety';

// UPD-3P：提示框文字改走 t()，先載入 zh-TW 字典；備用外觀改單行、拿掉說明行（測試同步更新）。
beforeAll(async () => {
  await setLocale('zh-TW');
});

afterAll(() => {
  localStorage.removeItem('toosterx:locale');
});

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
    expect(prompt?.textContent).not.toContain('完成目前操作後會自動更新');

    await vi.waitFor(() => {
      expect(prompt?.style.opacity).toBe('1');
    });

    expect(prompt?.classList.contains('sw-reload-fx')).toBe(false);
    expect(prompt?.querySelector('svg.orbit')).toBeNull();
    expect(prompt?.style.background).toBe('rgb(17, 24, 39)');
    expect(prompt?.style.cssText).toContain('32px');
    expect(document.querySelector('style[data-sw-reload-fx-instance]')).toBeNull();
    expect(document.body.classList.contains(UPDATE_PROMPT_OPEN_CLASS)).toBe(true);

    (prompt?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
    expect(document.body.classList.contains(UPDATE_PROMPT_OPEN_CLASS)).toBe(false);
  });

  it('備用外觀同樣單行：標題｜現在更新｜稍後，標題不換行、按鈕高 40px，沒有說明行', async () => {
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    const prompt = document.getElementById('sw-reload-deferred-prompt') as HTMLElement;
    await vi.waitFor(() => {
      expect(prompt.style.opacity).toBe('1');
    });
    const kids = [...prompt.children] as HTMLElement[];
    expect(kids).toHaveLength(3);
    expect(kids[0]?.hasAttribute('data-sw-reload-title')).toBe(true);
    expect(kids[0]?.textContent).toBe('有新版本可用');
    expect(kids[0]?.style.whiteSpace).toBe('nowrap');
    expect(kids[1]?.hasAttribute('data-sw-reload-now')).toBe(true);
    expect(kids[2]?.hasAttribute('data-sw-reload-later')).toBe(true);
    expect(prompt.style.display).toBe('flex');
    for (const button of [kids[1], kids[2]]) {
      expect(button?.style.minHeight).toBe('40px');
      expect(button?.style.whiteSpace).toBe('nowrap');
    }
    expect(prompt.dataset.dock).toBe('bare');
  });

  it('強制提示框在特效失敗時也沒有稍後，現在更新仍可用', async () => {
    const reload = vi.fn();
    showSwReloadPrompt(reload, 'min-build', { forced: true });
    const prompt = document.getElementById('sw-reload-deferred-prompt');
    expect(prompt?.dataset.mode).toBe('forced');
    expect(prompt?.textContent).toContain('請更新到新版');
    expect(prompt?.querySelector('[data-sw-reload-later]')).toBeNull();
    await vi.waitFor(() => {
      expect(prompt?.style.opacity).toBe('1');
    });
    expect(prompt?.querySelector('[data-sw-reload-later]')).toBeNull();
    (prompt?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
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
