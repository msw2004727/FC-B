import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./multi-tab-fx', () => {
  throw new Error('multi-tab chunk failed');
});

import { _resetMultiTabGuardForTest, showMultiTabWarning } from './multi-tab-guard';

describe('showMultiTabWarning 特效載入失敗', () => {
  afterEach(() => {
    _resetMultiTabGuardForTest();
    document.body.innerHTML = '';
  });

  it('import 失敗時退回舊外觀，提示仍在、按鈕仍可用', async () => {
    showMultiTabWarning();
    const overlay = document.getElementById('multi-tab-warning');
    expect(overlay).toBeTruthy();
    expect(overlay?.style.opacity).toBe('0');
    expect(overlay?.className).toBe('multi-tab-overlay');
    expect(overlay?.querySelector('.multi-tab-modal')).toBeTruthy();
    expect(overlay?.querySelector('.multi-tab-fx')).toBeNull();
    expect(overlay?.textContent).toContain('偵測到多個分頁開啟');
    expect(overlay?.textContent).toContain('為了穩定的登入與資料同步體驗，');
    expect(overlay?.textContent).toContain('建議只保留一個分頁。');
    expect(overlay?.querySelector('#multi-tab-dismiss')?.classList.contains('outline-btn')).toBe(true);
    expect(overlay?.querySelector('#multi-tab-close')?.classList.contains('primary-btn')).toBe(true);

    await vi.waitFor(() => {
      expect(overlay?.style.opacity).toBe('1');
    });

    expect(overlay?.querySelector('svg.orbit')).toBeNull();
    expect(overlay?.querySelector('.burst')).toBeNull();
    expect(overlay?.querySelector('.multi-tab-modal')?.classList.contains('multi-tab-fx')).toBe(false);
    expect(document.getElementById('multi-tab-fx-style')).toBeNull();
    expect(document.querySelector('style[data-multi-tab-fx-instance]')).toBeNull();

    (overlay?.querySelector('#multi-tab-dismiss') as HTMLButtonElement).click();
    expect(document.getElementById('multi-tab-warning')).toBeNull();
  });

  it('import 失敗時點「關閉其他分頁」仍可關掉', async () => {
    showMultiTabWarning();
    const overlay = document.getElementById('multi-tab-warning');
    await vi.waitFor(() => {
      expect(overlay?.style.opacity).toBe('1');
    });
    (overlay?.querySelector('#multi-tab-close') as HTMLButtonElement).click();
    expect(document.getElementById('multi-tab-warning')).toBeNull();
    expect(document.querySelector('.legacy-ui')).toBeNull();
  });
});
