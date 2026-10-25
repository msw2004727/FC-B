// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { ProfileInfoButton } from './ProfileInfoButton';

// 讓 lt/useLegacyT 直接回中文原文（等同 A 的 data-i18n fallback）。
vi.mock('@/i18n/i18n', () => ({
  useLegacyT: () => (key: string, fallback?: string) => fallback ?? key,
  lt: (key: string, fallback?: string) => fallback ?? key,
}));

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  _resetOverlayBackForTest();
});

afterEach(() => {
  cleanup();
  _resetOverlayBackForTest();
});

describe('ProfileInfoButton（M-121 前半）', () => {
  it('點「?」後出現說明視窗（標題＋body 文字）', () => {
    render(<ProfileInfoButton infoKey="myProfile" />);
    const trigger = screen.getByRole('button', { name: '?' });
    fireEvent.click(trigger);

    const dialog = document.querySelector('.edu-info-dialog');
    expect(dialog).not.toBeNull();
    const inDialog = within(dialog as HTMLElement);
    expect(inDialog.getByText('我的資料')).toBeTruthy();
    expect(inDialog.getByText(/讓主辦人在報名名單中快速了解參加者背景/)).toBeTruthy();
  });

  it('點「了解」後關閉說明視窗', () => {
    render(<ProfileInfoButton infoKey="myProfile" />);
    fireEvent.click(screen.getByRole('button', { name: '?' }));
    fireEvent.click(screen.getByText('了解'));
    expect(document.querySelector('.edu-info-overlay')).toBeNull();
  });

  it('點「?」不冒泡到外層（不會觸發外層 click handler）', () => {
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <ProfileInfoButton infoKey="myProfile" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: '?' }));
    expect(outer).not.toHaveBeenCalled();
  });

  it('點遮罩空白處關閉', () => {
    render(<ProfileInfoButton infoKey="myProfile" />);
    fireEvent.click(screen.getByRole('button', { name: '?' }));
    const overlay = document.querySelector('.edu-info-overlay') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    if (overlay) fireEvent.click(overlay);
    expect(document.querySelector('.edu-info-overlay')).toBeNull();
  });

  // 退修 2 P3 d：vitest 會略過 CSS，所以讀原始碼確認 ProfileInfoButton 自己載入說明按鈕／彈窗樣式。
  it('自己 import edu-info-btn.css（不靠 ProfilePage 先載入）', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/profile/components/legacy/ProfileInfoButton.tsx'),
      'utf8',
    );
    expect(source).toContain("import '@/styles/legacy/edu-info-btn.css';");
  });
});
