import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadCompetitionsDict } from '../i18n';
import { RosterBlocked } from './feedback';

// preact-iso 的 LocationProvider 在 window 攔截所有同網域 <a> 點擊並自行 pushState；
// 元件 onClick 又 route() 時會推兩筆同網址，返回要按兩次（11-20 預演）。
beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('賽事連結只推一筆歷史', () => {
  // 新外觀第 3 批小修（設計總監 05:08）：「返回名單」從帶底線的連結改成整列寬的次要鈕（原本找 role=link、href 是名單頁）
  it('名單擋下頁的「返回名單」：點一次 history.length 只加 1', () => {
    history.replaceState(null, '', '/competitions/cp_1/entries/en_1/add');
    render(
      <LocationProvider>
        <RosterBlocked reason="ENTRY_STATUS" cid="cp_1" enId="en_1" />
      </LocationProvider>,
    );
    const before = history.length;
    const back = screen.getByRole('button', { name: '返回名單' });
    expect(back.className).toContain('ui-button--secondary');
    expect(screen.getByRole('alert').textContent).toBe('這份報隊目前不能登錄名單');
    fireEvent.click(back);
    expect(location.pathname).toBe('/competitions/cp_1/entries/en_1');
    expect(history.length).toBe(before + 1);
  });

  // 獨立審 B P1：沒填生日被擋時要有去補生日的路（新外觀改版時漏掉了 409c4d77 的「前往個人資料」）
  it('沒填生日被擋：有「前往個人資料」主要鈕，點了到 /profile 只推一筆歷史', () => {
    history.replaceState(null, '', '/competitions/cp_1/entries/en_1/join');
    render(
      <LocationProvider>
        <RosterBlocked reason="BIRTHDAY_REQUIRED" cid="cp_1" enId="en_1" />
      </LocationProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain('請先補上生日');
    expect(screen.getByRole('button', { name: '返回名單' })).toBeTruthy();
    const before = history.length;
    const go = screen.getByRole('button', { name: '前往個人資料' });
    expect(go.className).toContain('ui-button--primary');
    fireEvent.click(go);
    expect(location.pathname).toBe('/profile');
    expect(history.length).toBe(before + 1);
  });

  it('其他原因不出現「前往個人資料」', () => {
    render(
      <LocationProvider>
        <RosterBlocked reason="ENTRY_STATUS" cid="cp_1" enId="en_1" />
      </LocationProvider>,
    );
    expect(screen.queryByRole('button', { name: '前往個人資料' })).toBeNull();
  });
});
