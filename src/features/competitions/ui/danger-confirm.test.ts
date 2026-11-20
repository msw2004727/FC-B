import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest, appConfirm } from '@/ui/AppConfirm';
import { DANGER_CONFIRM_CLASS, DANGER_CONFIRM_COUNT_ATTR, dangerConfirm } from './danger-confirm';

const root = (): HTMLElement => document.documentElement;
const marked = (): boolean => root().classList.contains(DANGER_CONFIRM_CLASS);
const count = (): string | null => root().getAttribute(DANGER_CONFIRM_COUNT_ATTR);

describe('dangerConfirm 危險確認框小函式', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(async () => ({ 'common.ok': '確定', 'common.cancel': '取消' }));
    await setLocale('zh-TW');
    render(h(AppConfirmHost, {}));
  });

  afterEach(() => {
    _resetAppConfirmForTest();
    cleanup();
    _setDictLoaderForTest(null);
    root().classList.remove(DANGER_CONFIRM_CLASS);
    root().removeAttribute(DANGER_CONFIRM_COUNT_ATTR);
  });

  it('開著時 <html> 有 class 與計數；按確定回 true，之後 class 與屬性都不在', async () => {
    const pending = dangerConfirm('確定要刪除這則公告？');
    expect(marked()).toBe(true);
    expect(count()).toBe('1');
    await screen.findByText('確定要刪除這則公告？');
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(pending).resolves.toBe(true);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();
  });

  it('按取消、Esc、返回鍵、測試重設之後 class 與屬性都不在', async () => {
    const byCancel = dangerConfirm('A');
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(byCancel).resolves.toBe(false);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();

    const byEsc = dangerConfirm('B');
    await screen.findByText('B');
    expect(marked()).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await expect(byEsc).resolves.toBe(false);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();

    const byBack = dangerConfirm('C');
    await screen.findByText('C');
    expect(marked()).toBe(true);
    history.back();
    await expect(byBack).resolves.toBe(false);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();

    const byReset = dangerConfirm('D');
    await screen.findByText('D');
    expect(marked()).toBe(true);
    _resetAppConfirmForTest();
    await expect(byReset).resolves.toBe(false);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();
  });

  it('連排兩個：第一個關掉 class 還在，第二個關掉才拿掉', async () => {
    const first = dangerConfirm('第一個');
    const second = dangerConfirm('第二個');
    expect(count()).toBe('2');
    await screen.findByText('第一個');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(first).resolves.toBe(false);
    expect(marked()).toBe(true);
    expect(count()).toBe('1');
    await screen.findByText('第二個');
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(second).resolves.toBe(true);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();
  });

  it('一般 appConfirm 不會加 class', async () => {
    const pending = appConfirm('確定要送出嗎？');
    await screen.findByText('確定要送出嗎？');
    expect(marked()).toBe(false);
    expect(count()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(pending).resolves.toBe(true);
    expect(marked()).toBe(false);
  });

  it('options 原樣轉給 appConfirm：確定鈕文字與預設焦點照呼叫端', async () => {
    const pending = dangerConfirm('確定要鎖定全部名單？', { okText: '鎖定', danger: false });
    await screen.findByText('確定要鎖定全部名單？');
    const ok = screen.getByRole('button', { name: '鎖定' });
    await waitFor(() => expect(document.activeElement).toBe(ok));
    fireEvent.click(ok);
    await expect(pending).resolves.toBe(true);
    expect(marked()).toBe(false);
  });
});
