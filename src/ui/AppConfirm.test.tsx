import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest, appAlert, appConfirm } from './AppConfirm';

describe('AppConfirm（A appConfirm／appAlert）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(async () => ({ 'common.ok': '確定', 'common.cancel': '取消' }));
    await setLocale('zh-TW');
    render(<AppConfirmHost />);
  });

  afterEach(() => {
    _resetAppConfirmForTest();
    cleanup();
    _setDictLoaderForTest(null);
  });

  it('確定 → true，訊息照原文顯示', async () => {
    const pending = appConfirm('確定要取消此活動？');
    expect(await screen.findByText('確定要取消此活動？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(pending).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByText('確定要取消此活動？')).toBeNull());
  });

  it('取消與 Esc → false', async () => {
    const first = appConfirm('A');
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(first).resolves.toBe(false);

    const second = appConfirm('B');
    await screen.findByText('B');
    fireEvent.keyDown(document, { key: 'Escape' });
    await expect(second).resolves.toBe(false);
  });

  it('一次只顯示一個，後到的排隊', async () => {
    const first = appConfirm('第一個');
    const second = appConfirm('第二個');
    await screen.findByText('第一個');
    expect(screen.queryByText('第二個')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(first).resolves.toBe(true);
    await screen.findByText('第二個');
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(second).resolves.toBe(true);
  });

  it('appAlert 只有一顆按鈕，可自訂文字', async () => {
    const pending = appAlert('提示', { okText: '知道了' });
    await screen.findByText('提示');
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    await expect(pending).resolves.toBeUndefined();
  });
});
