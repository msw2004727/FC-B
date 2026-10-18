import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { Text, clearSegmentCacheForTest } from '@/ui/Text';

describe('Text：英數代碼保護的長度上限', () => {
  beforeEach(async () => {
    await setLocale('zh-TW');
    clearSegmentCacheForTest();
  });
  afterEach(() => cleanup());

  it('短代碼整段包成 .ui-nobr', () => {
    const { container } = render(<Text>{'語言：zh-TW'}</Text>);
    expect(container.querySelector('.ui-nobr')?.textContent).toBe('zh-TW');
  });

  it('超過 24 字元的長代碼不包、也不只包其中一段', () => {
    const long = 'abc-def-ghi-jkl-mno-pqr-stu';
    const { container } = render(<Text>{`代碼：${long}`}</Text>);
    expect(container.querySelector('.ui-nobr')).toBeNull();
    expect(container.textContent).toBe(`代碼：${long}`);
  });
});
