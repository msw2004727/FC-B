import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { buildPlayerCardModel } from '../data/player-card-model';
import { PlayerCard } from './PlayerCard';

function stubMatchMedia(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    media: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function cardHtml(views?: number | null): string {
  const model = buildPlayerCardModel({ name: '王小明', avatarUrl: null, summary: null });
  const view = render(
    <PlayerCard
      model={model}
      avatar={<span>王</span>}
      {...(views === undefined ? {} : { popularityViews: views })}
    />,
  );
  const card = view.container.querySelector('.player-card');
  if (!card) throw new Error('missing card');
  return card.outerHTML;
}

describe('PlayerCard 人氣（沒有資料時與現況一致）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('null／undefined 的 .player-card outerHTML 與沒傳 prop 相同', () => {
    const plain = cardHtml(undefined);
    cleanup();
    const asNull = cardHtml(null);
    cleanup();
    const omitted = cardHtml();
    expect(asNull).toBe(plain);
    expect(omitted).toBe(plain);
    expect(plain).not.toContain('player-card-popularity');
    expect(plain).not.toContain('has-popularity');
  });

  it('有值時出現星星與數字，卡面帶 has-popularity，數字不加千分位', () => {
    const html = cardHtml(10000);
    expect(html).toContain('has-popularity');
    expect(html).toContain('player-card-popularity');
    expect(html).toContain('>10000<');
    expect(html).not.toContain('10,000');
    expect(html).toContain('人氣指數 5 顆星');
  });

  it('CSS 含名字下移與 has-popularity', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/profile/components/player-card.css'), 'utf8');
    expect(css).toContain('calc(31 * var(--pcu))');
    expect(css).toContain('has-popularity');
    expect(css).toContain('calc(-22 * var(--pcu))');
  });
});
