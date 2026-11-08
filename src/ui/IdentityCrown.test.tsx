import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { IdentityCrownSvg } from './IdentityCrown';

afterEach(() => {
  cleanup();
});

describe('IdentityCrownSvg', () => {
  it('同頁多個皇冠的漸層與裁切 id 各自不同，且各自引用自己的 id', () => {
    const { container } = render(
      <>
        <IdentityCrownSvg />
        <IdentityCrownSvg />
      </>,
    );
    const crowns = Array.from(container.querySelectorAll('svg.identity-crown'));
    expect(crowns).toHaveLength(2);
    const ids = crowns.map((svg) => {
      const gold = svg.querySelector('linearGradient')!.id;
      const clip = svg.querySelector('clipPath')!.id;
      expect(gold).toMatch(/^identityCrownGold-/);
      expect(clip).toMatch(/^identityCrownClip-/);
      expect((svg.querySelector('.identity-crown-body') as SVGElement).style.fill).toContain(`#${gold}`);
      expect(svg.querySelector('g')!.getAttribute('clip-path')).toBe(`url(#${clip})`);
      return [gold, clip];
    });
    expect(new Set(ids.flat()).size).toBe(4);
  });
});
