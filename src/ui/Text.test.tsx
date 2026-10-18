import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import {
  clearSegmentCacheForTest,
  clearSegmenterCacheForTest,
  segmentForWrap,
  Text,
} from '@/ui/Text';

beforeEach(async () => {
  localStorage.clear();
  clearSegmentCacheForTest();
  clearSegmenterCacheForTest();
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  clearSegmentCacheForTest();
  clearSegmenterCacheForTest();
  localStorage.clear();
});

describe('Text', () => {
  it('segmentForWrap 在 zh-TW 下會切詞，且完整詞語會等於某一片段', () => {
    const text = '台北馬拉松週末開放報名';
    const parts = segmentForWrap(text, 'zh-TW');

    expect(parts.join('')).toBe(text);
    expect(parts).toContain('馬拉松');
    expect(parts).toContain('報名');
  });

  it('zh-TW 下 render 會插入 wbr', () => {
    const { container } = render(<Text>{'台北馬拉松週末開放報名'}</Text>);

    expect(container.querySelectorAll('wbr').length).toBeGreaterThan(0);
    expect(container.innerHTML).toContain('<wbr>');
  });

  it('en 下 render 不會插入 wbr', async () => {
    await setLocale('en');

    const { container } = render(<Text>{'台北馬拉松週末開放報名'}</Text>);

    expect(container.querySelectorAll('wbr').length).toBe(0);
  });

  it('相同語系與字串第二次呼叫會命中快取', () => {
    const text = '台北馬拉松週末開放報名';
    const first = segmentForWrap(text, 'zh-TW');
    const second = segmentForWrap(text, 'zh-TW');

    expect(second).toBe(first);
  });

  it('沒有 Intl.Segmenter 時使用詞表降級，並在詞前後插入 wbr', () => {
    const intl = Intl as unknown as { Segmenter?: typeof Intl.Segmenter };
    const original = intl.Segmenter;
    intl.Segmenter = undefined;

    try {
      clearSegmentCacheForTest();
      clearSegmenterCacheForTest();

      const text = '台北報名馬拉松';
      const parts = segmentForWrap(text, 'zh-TW');

      expect(parts.join('')).toBe(text);
      expect(parts).toContain('報名');

      const { container } = render(<Text>{text}</Text>);
      expect(container.innerHTML).toContain('<wbr>報名<wbr>');
    } finally {
      intl.Segmenter = original;
      clearSegmentCacheForTest();
      clearSegmenterCacheForTest();
    }
  });

  it('zh-TW 這類英數代碼在 zh-TW 語系會包在 .ui-nobr 內', () => {
    const { container } = render(<Text>{'zh-TW'}</Text>);
    const nobr = container.querySelector('.ui-nobr');

    expect(nobr?.textContent).toBe('zh-TW');
  });

  it('ja 與 zh-CN 的降級詞表生效', () => {
    const intl = Intl as unknown as { Segmenter?: typeof Intl.Segmenter };
    const original = intl.Segmenter;
    intl.Segmenter = undefined;

    try {
      clearSegmentCacheForTest();
      clearSegmenterCacheForTest();

      expect(segmentForWrap('イベントに申し込み', 'ja')).toContain('イベント');
      expect(segmentForWrap('イベントに申し込み', 'ja')).toContain('申し込み');
      expect(segmentForWrap('活动报名中', 'zh-CN')).toContain('活动');
      expect(segmentForWrap('活动报名中', 'zh-CN')).toContain('报名中');
    } finally {
      intl.Segmenter = original;
      clearSegmentCacheForTest();
      clearSegmenterCacheForTest();
    }
  });

  it('同語系多個不同字串只建立一個 Segmenter', () => {
    const intl = Intl as unknown as { Segmenter?: typeof Intl.Segmenter };
    const MaybeOriginal = intl.Segmenter;
    if (!MaybeOriginal) return;
    const Original: typeof Intl.Segmenter = MaybeOriginal;

    let count = 0;
    function CountingSegmenter(
      this: unknown,
      locale?: string,
      options?: Intl.SegmenterOptions,
    ): Intl.Segmenter {
      count += 1;
      return new Original(locale, options);
    }

    intl.Segmenter = CountingSegmenter as unknown as typeof Intl.Segmenter;
    clearSegmentCacheForTest();
    clearSegmenterCacheForTest();

    try {
      segmentForWrap('台北馬拉松', 'zh-TW');
      segmentForWrap('報名開始', 'zh-TW');

      expect(count).toBe(1);
    } finally {
      intl.Segmenter = Original;
      clearSegmentCacheForTest();
      clearSegmenterCacheForTest();
    }
  });
});
