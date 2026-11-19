import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { LOCALES } from '@/i18n/locales';
import { RelayScreen, WaitScreen } from './HandoffViews';
import { HANDOFF_TEXT_FOR_TEST } from './messages';
import { renderRelay, renderWait } from './view';
import type { RelayHandlers, WaitHandlers } from './view-types';

/** 文字依標點拆成多段 span，比對整段 <p> 的文字。 */
function para(text: string): HTMLElement {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

function waitHandlers(): WaitHandlers {
  return { onDone: vi.fn(), onRestart: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
}
function relayHandlers(): RelayHandlers {
  return { onPick: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
}

beforeEach(async () => {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  renderWait(null, waitHandlers());
  renderRelay(null, relayHandlers());
  _resetOverlayBackForTest();
  vi.useRealTimers();
});

describe('文案', () => {
  it('七語鍵相同、都不指名 Safari、倒數帶 {time}', () => {
    const keys = Object.keys(HANDOFF_TEXT_FOR_TEST['zh-TW']).sort();
    for (const locale of LOCALES) {
      const text = HANDOFF_TEXT_FOR_TEST[locale];
      expect(Object.keys(text).sort()).toEqual(keys);
      for (const value of Object.values(text)) {
        expect(value).not.toMatch(/safari/i);
        expect(value.trim()).not.toBe('');
      }
      expect(text.remain).toContain('{time}');
    }
  });
});

describe('等待框', () => {
  it('④ 顯示數字與倒數，按鈕對應 handler；busy 時「我已完成」停用', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const h = waitHandlers();
    const expiresAt = Date.now() + 272_000;
    const { rerender } = render(<WaitScreen view={{ kind: 'wait', number: 27, expiresAt, busy: false }} handlers={h} />);
    expect(screen.getByText('等待瀏覽器確認')).toBeTruthy();
    expect(screen.getByText('27')).toBeTruthy();
    expect(screen.getByText('剩餘 4:32')).toBeTruthy();
    fireEvent.click(screen.getByText('我已完成'));
    expect(h.onDone).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('取消，重新登入'));
    expect(h.onRestart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('關閉'));
    expect(h.onClose).toHaveBeenCalledOnce();
    rerender(<WaitScreen view={{ kind: 'wait', number: 27, expiresAt, busy: true }} handlers={h} />);
    expect((screen.getByText('我已完成') as HTMLButtonElement).disabled).toBe(true);
  });

  it('⑤ 還沒收到：按鈕「我已完成」（與內文一致，站長選 B）＝onRetry，重新登入＝onRestart', () => {
    const h = waitHandlers();
    render(<WaitScreen view={{ kind: 'notYet', number: 27, expiresAt: Date.now() + 60_000 }} handlers={h} />);
    expect(screen.getByText('還沒收到登入資料')).toBeTruthy();
    expect(screen.queryByText('再試一次')).toBeNull();
    fireEvent.click(screen.getByText('我已完成'));
    expect(h.onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('重新登入'));
    expect(h.onRestart).toHaveBeenCalledOnce();
  });

  it('⑥ 逾時：重新登入＝onRestart，取消＝onClose', () => {
    const h = waitHandlers();
    render(<WaitScreen view={{ kind: 'timeout' }} handlers={h} />);
    expect(screen.getByText('登入已逾時')).toBeTruthy();
    fireEvent.click(screen.getByText('重新登入'));
    expect(h.onRestart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('取消'));
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it('英文介面切換文案', async () => {
    await setLocale('en');
    render(<WaitScreen view={{ kind: 'timeout' }} handlers={waitHandlers()} />);
    expect(screen.getByText('Sign-in timed out')).toBeTruthy();
  });
});

describe('轉交頁', () => {
  it('① 三個數字按鈕與警語；選數字＝onPick；busy 時停用', () => {
    const h = relayHandlers();
    const { rerender } = render(
      <RelayScreen view={{ kind: 'pick', options: [27, 81, 46], busy: false, tryLater: false }} handlers={h} />,
    );
    expect(screen.getByRole('note').textContent).toContain('請關閉此頁');
    fireEvent.click(screen.getByText('81'));
    expect(h.onPick).toHaveBeenCalledWith(81);
    expect(para('選錯一次，這次登入就會作廢')).toBeTruthy();
    rerender(<RelayScreen view={{ kind: 'pick', options: [27, 81, 46], busy: true, tryLater: false }} handlers={h} />);
    expect((screen.getByText('27') as HTMLButtonElement).disabled).toBe(true);
  });

  it('稍後再試：顯示提示與重試鈕，重試＝onRetry', () => {
    const h = relayHandlers();
    render(<RelayScreen view={{ kind: 'pick', options: [27, 81, 46], busy: false, tryLater: true }} handlers={h} />);
    expect(screen.getByRole('alert').textContent).toBe('連線不穩，請稍後再試');
    fireEvent.click(screen.getByText('再試一次'));
    expect(h.onRetry).toHaveBeenCalledOnce();
  });

  it('② 已轉交、③ 數字不符、已送出或已失效（不顯示失敗字樣）', () => {
    const h = relayHandlers();
    const { rerender } = render(<RelayScreen view={{ kind: 'done' }} handlers={h} />);
    expect(screen.getByText('請回到主畫面 App')).toBeTruthy();
    expect(para('這個頁面不會登入，可以關掉。')).toBeTruthy();
    rerender(<RelayScreen view={{ kind: 'wrong' }} handlers={h} />);
    expect(screen.getByText('數字不符')).toBeTruthy();
    fireEvent.click(screen.getByText('關閉此頁'));
    expect(h.onClose).toHaveBeenCalledOnce();
    rerender(<RelayScreen view={{ kind: 'sentOrExpired' }} handlers={h} />);
    expect(para('這次登入已送出或已失效，請回到主畫面 App 查看。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('失敗');
  });
});

describe('斷行', () => {
  it('只在標點後切段，「數字」不會被拆開', () => {
    render(<WaitScreen view={{ kind: 'notYet', number: 27, expiresAt: Date.now() + 60_000 }} handlers={waitHandlers()} />);
    const segs = [...para('請確認已在瀏覽器選好數字，再按一次「我已完成」。').querySelectorAll('.login-handoff-seg')].map((el) => el.textContent);
    expect(segs).toEqual(['請確認已在瀏覽器選好數字，', '再按一次「我已完成」。']);
  });

  it('英文不在半形標點切段（句點後的空格保留）', async () => {
    await setLocale('en');
    render(<RelayScreen view={{ kind: 'pick', options: [27, 81, 46], busy: false, tryLater: true }} handlers={relayHandlers()} />);
    const alert = screen.getByRole('alert');
    expect(alert.querySelectorAll('.login-handoff-seg').length).toBe(1);
    expect(alert.textContent).toBe('Connection unstable. Please try again.');
  });
});

describe('掛載', () => {
  it('renderWait 建立容器、更新、null 時移除', () => {
    const h = waitHandlers();
    renderWait({ kind: 'timeout' }, h);
    expect(document.querySelectorAll('[data-login-handoff="wait"]').length).toBe(1);
    renderWait({ kind: 'notYet', number: 12, expiresAt: Date.now() + 1000 }, h);
    expect(document.querySelectorAll('[data-login-handoff="wait"]').length).toBe(1);
    expect(screen.getByText('還沒收到登入資料')).toBeTruthy();
    renderWait(null, h);
    expect(document.querySelector('[data-login-handoff="wait"]')).toBeNull();
  });

  it('renderRelay 與 renderWait 各自獨立', () => {
    renderRelay({ kind: 'done' }, relayHandlers());
    expect(document.querySelector('[data-login-handoff="relay"]')).not.toBeNull();
    renderRelay(null, relayHandlers());
    expect(document.querySelector('[data-login-handoff="relay"]')).toBeNull();
  });
});
