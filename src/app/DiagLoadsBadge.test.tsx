import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagLoadsBadge } from './DiagLoadsBadge';

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('DiagLoadsBadge', () => {
  it('hostname 不是 next.toosterx.com 時不渲染、不寫 sessionStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    sessionStorage.setItem('fcb:diag-loads', JSON.stringify([
      { n: 1, path: '/', q: ['liff.state'], h: ['access_token'], rewrote: true },
    ]));
    setItem.mockClear();
    for (const hostname of ['localhost', 'toosterx.com', 'www.toosterx.com', 'next.toosterx.com.evil.test']) {
      const view = render(<DiagLoadsBadge hostname={hostname} />);
      expect(view.container.querySelector('.fcb-diag-loads')).toBeNull();
      expect(view.container.textContent).not.toContain('liff.state');
      view.unmount();
    }
    const bare = render(<DiagLoadsBadge />);
    expect(location.hostname).not.toBe('next.toosterx.com');
    expect(bare.container.querySelector('.fcb-diag-loads')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('next.toosterx.com 列出名稱，紀錄裡的值與多餘欄位都不畫出來', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    sessionStorage.setItem('fcb:diag-loads', JSON.stringify([{
      n: 1,
      path: '/',
      q: ['liff.state', 'code'],
      h: ['access_token', 'id_token'],
      rewrote: true,
      token: 'SECRET_X',
      href: 'SECRET_Y',
    }]));
    setItem.mockClear();
    const view = render(<DiagLoadsBadge hostname="next.toosterx.com" />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('liff.state');
    expect(text).toContain('code');
    expect(text).toContain('access_token');
    expect(text).toContain('id_token');
    expect(text).toContain('rewrote');
    expect(text).toContain('1 /');
    expect(text).not.toContain('SECRET_X');
    expect(text).not.toContain('SECRET_Y');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('點一下收合，再點展開', () => {
    sessionStorage.setItem('fcb:diag-loads', JSON.stringify([
      { n: 2, path: '/', q: ['liff.state'], h: [], rewrote: false },
    ]));
    render(<DiagLoadsBadge hostname="next.toosterx.com" />);
    expect(screen.getByText(/liff\.state/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收合' }));
    expect(screen.queryByText(/liff\.state/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '診斷' }));
    expect(screen.getByText(/liff\.state/)).toBeTruthy();
  });

  it('sessionStorage 壞掉仍只顯示空角標，不往外拋', () => {
    sessionStorage.setItem('fcb:diag-loads', '{');
    const view = render(<DiagLoadsBadge hostname="next.toosterx.com" />);
    expect(view.container.querySelector('.fcb-diag-loads')).not.toBeNull();
    expect(view.container.textContent).not.toContain('SECRET_X');
    expect(view.container.querySelectorAll('li')).toHaveLength(0);
  });

  it('元件用文字節點、App 有掛上，且不讀網址的值', () => {
    const source = read('DiagLoadsBadge.tsx');
    expect(source).not.toContain('innerHTML');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toContain('location.href');
    expect(source).not.toContain('location.search');
    expect(source).not.toContain('location.hash');
    expect(source).not.toContain('sessionStorage.setItem');
    expect(read('App.tsx')).toMatch(/<DiagLoadsBadge\s*\/>/);
  });
});
