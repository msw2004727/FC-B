// 清單頁危險確認框（清-5）：開著時 <html> 掛 class 與計數，關掉就拿掉；與站內賽事那份名稱相同、共用同一個計數。
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { h } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import * as inApp from '@/features/competitions/ui/danger-confirm';
import { DANGER_CONFIRM_CLASS, DANGER_CONFIRM_COUNT_ATTR, dangerConfirm } from './danger-confirm';

const root = (): HTMLElement => document.documentElement;
const marked = (): boolean => root().classList.contains(DANGER_CONFIRM_CLASS);
const count = (): string | null => root().getAttribute(DANGER_CONFIRM_COUNT_ATTR);

describe('清單頁 dangerConfirm', () => {
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

  it('class 與計數屬性名稱與站內賽事那份相同', () => {
    expect(DANGER_CONFIRM_CLASS).toBe(inApp.DANGER_CONFIRM_CLASS);
    expect(DANGER_CONFIRM_COUNT_ATTR).toBe(inApp.DANGER_CONFIRM_COUNT_ATTR);
  });

  it('開著時掛上；按確定回 true、按取消回 false，之後都拿掉', async () => {
    const ok = dangerConfirm('確定要刪除「甲」嗎？');
    expect(marked()).toBe(true);
    expect(count()).toBe('1');
    await screen.findByText('確定要刪除「甲」嗎？');
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await expect(ok).resolves.toBe(true);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();

    const no = dangerConfirm('乙');
    await screen.findByText('乙');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(no).resolves.toBe(false);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();
  });

  it('與站內那份同時排隊：共用計數，兩個都關掉才拿掉 class', async () => {
    const mine = dangerConfirm('清單頁');
    const other = inApp.dangerConfirm('站內');
    expect(count()).toBe('2');
    await screen.findByText('清單頁');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(mine).resolves.toBe(false);
    expect(marked()).toBe(true);
    expect(count()).toBe('1');
    await screen.findByText('站內');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(other).resolves.toBe(false);
    expect(marked()).toBe(false);
    expect(count()).toBeNull();
  });

  it('兩條樣式在 list-v2.css 與 competitions.css 逐字相同', () => {
    const pick = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('.cp-danger-confirm #app-confirm-modal .app-confirm-ok'));
    const list = pick('src/features/tournaments/list-v2.css');
    expect(list).toHaveLength(2);
    expect(list).toEqual(pick('src/features/competitions/competitions.css'));
  });
});
