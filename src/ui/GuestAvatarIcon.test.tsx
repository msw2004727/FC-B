// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';

import { GuestAvatarIcon } from './GuestAvatarIcon';

afterEach(() => cleanup());

describe('GuestAvatarIcon（M-168）', () => {
  it('輸出 svg.guest-avatar-icon，並有 aria-hidden="true"、focusable="false"', () => {
    const { container } = render(<GuestAvatarIcon />);
    const svg = container.querySelector('svg.guest-avatar-icon');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
  });

  it('預設 size 28；可指定大小', () => {
    const { container: c1 } = render(<GuestAvatarIcon />);
    const s1 = c1.querySelector('svg');
    expect(s1?.getAttribute('width')).toBe('28');
    expect(s1?.getAttribute('height')).toBe('28');
    cleanup();
    const { container: c2 } = render(<GuestAvatarIcon size={40} />);
    const s2 = c2.querySelector('svg');
    expect(s2?.getAttribute('width')).toBe('40');
    expect(s2?.getAttribute('height')).toBe('40');
  });
  it('size 可給百分比字串（隨外層頭像圓縮放）', () => {
    const { container } = render(<GuestAvatarIcon size="62%" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('62%');
  });

  it('fill 版：貼邊放大的 viewBox，肩膀往下多畫（圓底邊不留縫隙）；一般版不變', () => {
    const { container: normal } = render(<GuestAvatarIcon />);
    expect(normal.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(normal.querySelector('path')?.getAttribute('d')).toContain('v1H4z');
    cleanup();
    const { container } = render(<GuestAvatarIcon size="100%" fill />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('3 2 18 19.5');
    expect(container.querySelector('path')?.getAttribute('d')).toContain('v4H4z');
  });
});
