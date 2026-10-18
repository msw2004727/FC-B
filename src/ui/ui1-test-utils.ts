import { act, cleanup, fireEvent } from '@testing-library/preact';
import { afterEach, beforeEach, expect } from 'vitest';
import {
  _setDictLoaderForTest,
  setLocale,
} from '@/i18n/i18n';

/**
 * 純測試 fixture，不是產品字典。
 * 本批元件沒有固定文案：所有內容與 IconButton label 由呼叫端翻譯，
 * loading 保留原名稱並以 aria-busy 表達，因此 ui1.json 不新增 key。
 */
export function installUiTestLocale(): void {
  beforeEach(async () => {
    _setDictLoaderForTest(async (locale) => ({
      'fixture.action': locale === 'en' ? 'Find activities' : '找活動',
      'fixture.heading': locale === 'en' ? 'Next activity' : '下一場活動',
      'fixture.subtitle': locale === 'en' ? 'View details' : '查看活動詳情',
      'fixture.icon': locale === 'en' ? 'Open calendar' : '開啟日曆',
    }));
    await setLocale('zh-TW');
  });

  afterEach(async () => {
    cleanup();
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
  });
}

/**
 * jsdom 不實作 Enter / Space 的瀏覽器預設 activation。
 * 此處驗證原生元素、focus 與事件不被攔截；
 * 真正的鍵盤 activation／Tab 順序仍需瀏覽器驗收。
 */
export function expectNativeKeyboard(element: HTMLElement, keys: string[]): void {
  act(() => element.focus());
  expect(document.activeElement).toBe(element);

  for (const key of keys) {
    expect(fireEvent.keyDown(element, { key })).toBe(true);
    expect(fireEvent.keyUp(element, { key })).toBe(true);
  }
}

export function expectBlockedLink(element: HTMLElement): void {
  expect(element.tagName).toBe('A');
  expect(element.getAttribute('href')).toBeNull();
  expect(element.getAttribute('aria-disabled')).toBe('true');
  expect(element.tabIndex).toBe(-1);
  expect(fireEvent.click(element)).toBe(false);
  expect(fireEvent(element, new MouseEvent('auxclick', {
    bubbles: true,
    cancelable: true,
    button: 1,
  }))).toBe(false);
  expect(fireEvent.keyDown(element, { key: 'Enter' })).toBe(false);
  expect(fireEvent.keyDown(element, { key: ' ' })).toBe(false);
}
