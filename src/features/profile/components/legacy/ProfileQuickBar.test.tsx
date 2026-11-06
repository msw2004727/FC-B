// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileQuickBar, type QuickItem } from './ProfileQuickBar';

afterEach(() => cleanup());

function items(extra: Partial<QuickItem> = {}): QuickItem[] {
  return [
    {
      key: 'a',
      icon: 'reg',
      label: '報名',
      ariaLabel: '我的報名，120 筆',
      badge: 120,
      render: () => (
        <div>
          <input aria-label="輸入框" />
          <div role="dialog" aria-modal="true">
            <button type="button">彈窗按鈕</button>
          </div>
          <button type="button">內容按鈕</button>
        </div>
      ),
      ...extra,
    },
    { key: 'b', icon: 'bell', label: '推播', ariaLabel: 'LINE 推播，已綁定', dot: true, render: () => <p>B 內容</p> },
  ];
}

function btn(key: string): HTMLButtonElement {
  return document.getElementById(`profile-quick-btn-${key}`) as HTMLButtonElement;
}

describe('ProfileQuickBar', () => {
  it('徽章超過 99 顯示 99+；綠點只在 dot 項目', () => {
    render(<ProfileQuickBar items={items()} groupLabel="個人設定" />);
    expect(btn('a').querySelector('.profile-quick-badge')?.textContent).toBe('99+');
    expect(btn('a').querySelector('.profile-quick-dot')).toBeNull();
    expect(btn('b').querySelector('.profile-quick-dot')).not.toBeNull();
    expect(btn('b').querySelector('.profile-quick-badge')).toBeNull();
  });

  it('輸入框與彈窗內的 Esc 不收合；一般內容的 Esc 收合並還焦點', () => {
    render(<ProfileQuickBar items={items()} groupLabel="個人設定" />);
    fireEvent.click(btn('a'));
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(btn('a').getAttribute('aria-expanded')).toBe('true');
    const dialogBtn = document.querySelector('[role="dialog"] button') as HTMLButtonElement;
    fireEvent.keyDown(dialogBtn, { key: 'Escape' });
    expect(btn('a').getAttribute('aria-expanded')).toBe('true');

    const contentBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '內容按鈕')!;
    contentBtn.focus();
    fireEvent.keyDown(contentBtn, { key: 'Escape' });
    expect(btn('a').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn('a'));
  });

  it('已被攔下（defaultPrevented）的 Esc 不收合', () => {
    render(<ProfileQuickBar items={items()} groupLabel="個人設定" />);
    fireEvent.click(btn('b'));
    const p = document.querySelector('p') as HTMLElement;
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    p.dispatchEvent(ev);
    expect(btn('b').getAttribute('aria-expanded')).toBe('true');
  });

  it('展開中的項目從清單消失時，展開區一併收合', () => {
    const { rerender } = render(<ProfileQuickBar items={items()} groupLabel="個人設定" />);
    fireEvent.click(btn('b'));
    expect(document.getElementById('profile-quick-panel')?.hidden).toBe(false);
    rerender(<ProfileQuickBar items={items().filter((i) => i.key !== 'b')} groupLabel="個人設定" />);
    expect(document.getElementById('profile-quick-panel')?.hidden).toBe(true);
    expect(btn('a').getAttribute('aria-expanded')).toBe('false');
  });
});
