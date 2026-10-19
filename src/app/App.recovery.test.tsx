import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { App } from '@/app/App';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import type { FeatureManifest } from '@/core/feature-types';

function Boom(): never {
  throw new Error('boom');
}

function Fine(): preact.JSX.Element {
  return <p data-testid="fine">fine page</p>;
}

const manifests: FeatureManifest[] = [
  { id: 'home', status: 'enabled', routes: [{ path: '/', load: () => Promise.resolve({ default: Fine }), titleKey: 'home.title' }], nav: [{ path: '/', labelKey: 'home.nav', icon: 'home', order: 0 }] },
  { id: 'broken', status: 'enabled', routes: [{ path: '/broken', load: () => Promise.resolve({ default: Boom }), titleKey: 'broken.title' }] },
];

describe('App 路由錯誤復原', () => {
  beforeEach(() => {
    _resetForTest();
    registerFeatures(manifests);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/broken');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('頁面拋錯時外框仍在，站內導覽到其他頁可離開錯誤畫面', async () => {
    const { container, findByTestId } = render(<App />);

    // 錯誤畫面出現，外框（header、nav）仍在
    await waitFor(() => expect(container.querySelector('.error-fallback, [role="alert"]')).not.toBeNull());
    expect(container.querySelector('header')).not.toBeNull();
    expect(container.querySelector('nav')).not.toBeNull();

    // 點底部導覽回首頁
    // 測試同步更新（R-QA-005）：底部導覽改照 A，項目是按鈕（#bottom-tabs .bot-tab）。
    const homeLink = Array.from(container.querySelectorAll('#bottom-tabs .bot-tab'))
      .find((el) => el.textContent?.includes('首頁')) ?? null;
    expect(homeLink).not.toBeNull();
    fireEvent.click(homeLink as Element);

    expect(await findByTestId('fine')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });
});
