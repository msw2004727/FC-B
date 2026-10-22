import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';

import {
  formatPmTime,
  normalizeExternalHttpsUrl,
  renderPmMessageBody,
  splitUrlTrailingPunctuation,
} from './pm-message-format';

afterEach(cleanup);

describe('pm-message-format', () => {
  it('formatPmTime 照 A 格式', () => {
    expect(formatPmTime('2024-01-02T03:04:05Z')).toBe('2024-01-02T03:04:05Z');
    expect(formatPmTime(Date.parse('2024-01-02T03:04:05Z'))).toBe('2024-01-02 03:04');
  });

  it('splitUrlTrailingPunctuation 分離尾端標點', () => {
    expect(splitUrlTrailingPunctuation('https://a.com/x。')).toEqual({
      urlText: 'https://a.com/x',
      suffix: '。',
    });
  });

  it('normalizeExternalHttpsUrl 只留 https 網址', () => {
    expect(normalizeExternalHttpsUrl('http://a.com')).toBe('');
    expect(normalizeExternalHttpsUrl('https://a.com/x')).toBe('https://a.com/x');
  });

  it('renderPmMessageBody 產生安全連結與尾端標點', () => {
    const { nodes, hasExternalLink } = renderPmMessageBody('看 https://a.com/x。');
    const { container } = render(<div>{nodes}</div>);
    const anchor = container.querySelector('a');

    expect(hasExternalLink).toBe(true);
    expect(anchor?.getAttribute('href')).toBe('https://a.com/x');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(container.textContent).toContain('。');
  });
});
