import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { PageSpinner } from './PageSpinner';

// 相對路徑放變數：Vite 會把 new URL 的字面相對路徑改寫成開發資源網址。
const cssRelativePath = './page-spinner.css';
const css = readFileSync(new URL(cssRelativePath, import.meta.url), 'utf8');

beforeEach(async () => {
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
});

describe('PageSpinner', () => {
  it('置中轉圈：role=status、既有載入文案只在 aria-label、沒有可見文字', async () => {
    render(<PageSpinner />);
    const status = screen.getByRole('status');
    expect(status.classList.contains('ui-page-spinner')).toBe(true);
    expect(status.getAttribute('aria-label')).toBe('載入中…');
    expect(status.textContent).toBe('');
    const ring = status.querySelector('svg');
    expect(ring?.classList.contains('ui-page-spinner__ring')).toBe(true);
    expect(ring?.getAttribute('width')).toBe('28');
    expect(ring?.getAttribute('height')).toBe('28');
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(css).toContain('color: var(--accent)');
    expect(css).toContain('animation: ui-spin var(--ui-spin-dur) var(--ui-ease) infinite');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation:\s*none/);
  });
});
