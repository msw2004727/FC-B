import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { setLocale } from '@/i18n/i18n';
import { getToasts, toast } from '@/ui/Toast';
import { ContactOwnerEntry } from './ContactOwnerEntry';

const fabCss = readFileSync(join(process.cwd(), 'src/features/home/components/contact-owner-fab.css'), 'utf8');
const homeCss = readFileSync(join(process.cwd(), 'src/features/home/legacy/home.css'), 'utf8');

const loader = vi.hoisted(() => ({
  calls: 0,
  failNext: false,
}));

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  signIn: mocks.signIn,
}));

vi.mock('../data/contact-owner-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/contact-owner-loader')>();
  return {
    ...actual,
    loadContactOwnerModal: () => {
      loader.calls += 1;
      if (loader.failNext) return Promise.reject(new Error('chunk load failed'));
      return actual.loadContactOwnerModal();
    },
  };
});

beforeEach(async () => {
  loader.calls = 0;
  loader.failNext = false;
  mocks.signIn.mockReset();
  mocks.signIn.mockResolvedValue({ uid: 'u1' });
  toast.clear();
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  toast.clear();
  _resetOverlayBackForTest();
});

describe('ContactOwnerEntry', () => {
  it('浮球在首頁右下、疊在浮動廣告之上', () => {
    render(<ContactOwnerEntry signedIn={false} />);
    const fab = screen.getByRole('button', { name: '聯繫站長' });
    expect(fab.classList.contains('contact-owner-fab')).toBe(true);
    expect(fab.querySelector('path')?.getAttribute('d')).toBe('M3.5 6.5 12 13l8.5-6.5');
    expect(fabCss).toMatch(/right:\s*\.9rem/);
    expect(fabCss).toMatch(/var\(--bottombar-h,\s*64px\)/);
    expect(fabCss).toMatch(/\+\s*20px/);
    expect(fabCss).toMatch(/background:\s*var\(--warning\)/);
    expect(fabCss).toMatch(/z-index:\s*60/);
    expect(fabCss).toMatch(/\[data-theme="dark"\] \.contact-owner-fab\s*\{[^}]*color:\s*var\(--bg-card\)/);
    expect(homeCss).toMatch(/\.floating-ads\s*\{[^}]*z-index:\s*50/);
  });

  it('未登入點擊走登入，不載入、不開彈窗', async () => {
    render(<ContactOwnerEntry signedIn={false} />);
    fireEvent.click(screen.getByRole('button', { name: '聯繫站長' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(loader.calls).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('已登入點擊才載入並打開彈窗', async () => {
    render(<ContactOwnerEntry signedIn />);
    fireEvent.click(screen.getByRole('button', { name: '聯繫站長' }));
    expect(await screen.findByRole('dialog', { name: '聯繫站長' })).toBeTruthy();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(loader.calls).toBe(1);
    expect(screen.getByRole('textbox', { name: '稱呼' })).toBeTruthy();
  });

  it('彈窗載入失敗時不開彈窗並提示', async () => {
    loader.failNext = true;
    render(<ContactOwnerEntry signedIn />);
    fireEvent.click(screen.getByRole('button', { name: '聯繫站長' }));
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getToasts()[0]?.message).toBe('載入失敗，請稍後再試');
  });

  it('浮球只掛在首頁，且首頁不靜態載入彈窗與 Callable', () => {
    const files = import.meta.glob(
      ['../../../**/*.{ts,tsx}', '!../../../**/*.test.ts', '!../../../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    const hits = Object.entries(files)
      .filter(([, source]) => source.includes('ContactOwnerEntry'))
      .map(([path]) => path.replaceAll('\\', '/'));
    expect(hits.length).toBeGreaterThan(0);
    for (const path of hits) {
      expect(
        path.endsWith('HomePage.tsx') || path.endsWith('ContactOwnerEntry.tsx'),
        path,
      ).toBe(true);
    }

    const guarded = import.meta.glob(
      ['./ContactOwnerEntry.tsx', '../data/contact-owner-loader.ts', '../pages/HomePage.tsx'],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    expect(Object.keys(guarded).length).toBe(3);
    for (const [file, source] of Object.entries(guarded)) {
      const staticImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm)]
        .map((match) => match[1] ?? '');
      const offending = staticImports.filter((spec) =>
        /ContactOwnerModal|submit-contact-message|data\/callables/.test(spec));
      expect(offending, file).toEqual([]);
      expect(source.includes('<ContactOwnerEntry') || file.endsWith('ContactOwnerEntry.tsx') || file.endsWith('contact-owner-loader.ts')).toBe(true);
    }
    const home = Object.entries(guarded).find(([file]) => file.endsWith('HomePage.tsx'))?.[1] ?? '';
    expect(home).toContain('<ContactOwnerEntry');
  });
});
