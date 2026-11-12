import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { CourseStatus } from './CoursePageShell';

beforeAll(async () => {
  await setLocale('zh-TW');
});

afterEach(() => cleanup());

describe('CourseStatus', () => {
  it('載入中是 PageSpinner（圈＋既有載入文字），空與錯誤維持原畫面', () => {
    const loading = render(<CourseStatus kind="loading" text="載入中…" />);
    const status = screen.getByRole('status');
    expect(status.classList.contains('ui-page-spinner')).toBe(true);
    expect(status.querySelector('.ui-page-spinner__ring')).toBeTruthy();
    expect(status.getAttribute('aria-label')).toBe('載入中…');
    expect(status.textContent).toContain('不要催，已經在努力加載中！');
    expect(status.getAttribute('aria-busy')).toBeNull();
    expect(loading.container.querySelector('.ck-empty')).toBeNull();
    loading.unmount();

    render(<CourseStatus kind="empty" text="找不到課程" />);
    expect(screen.getByText('找不到課程')).toBeTruthy();
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
    expect(document.querySelector('.ck-empty')?.getAttribute('data-status')).toBe('empty');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    cleanup();

    render(<CourseStatus kind="error" text="讀取失敗" onRetry={() => undefined} retryText="重新嘗試" />);
    const alert = screen.getByRole('alert');
    expect(alert.classList.contains('ck-empty')).toBe(true);
    expect(alert.textContent).toContain('讀取失敗');
    expect(screen.getByRole('button', { name: '重新嘗試' })).toBeTruthy();
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
  });
});
