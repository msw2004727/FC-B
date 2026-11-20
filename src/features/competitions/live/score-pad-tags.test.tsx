import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { installUi4TestLocale } from '@/ui/ui4-test-helpers';
import { S4_SCENE_FT, S4_SCENE_LIVE, S4_SCENE_PK, S4_SCENE_PRE } from '../testing/step4-fixtures';
import { ScorePad } from './ScorePad';

installUi4TestLocale();

afterEach(() => cleanup());

const css = readFileSync(join(process.cwd(), 'src/features/competitions/live/live.css'), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return hit?.[1] ?? '';
}

function tagNames(): string[] {
  return [...document.querySelectorAll('.s4-tags .s4-tag .s4-col__name')].map((el) => el.textContent ?? '');
}

describe('進球上方隊名標籤與分隔線', () => {
  it('兩欄標籤文字等於隊名，主隊在左、客隊在右', () => {
    render(<ScorePad {...S4_SCENE_LIVE} />);
    expect(tagNames()).toEqual([S4_SCENE_LIVE.match.home.name, S4_SCENE_LIVE.match.away.name]);
    const tags = [...document.querySelectorAll('.s4-tags .s4-tag')];
    expect(tags[0]?.classList.contains('s4-tag--home')).toBe(true);
    expect(tags[1]?.classList.contains('s4-tag--away')).toBe(true);
    // 標籤只給眼睛看；進球鈕 aria-label 已含隊名。
    expect(document.querySelector('.s4-tags')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('長隊名照樣是同一個隊名，CSS 單行加省略號', () => {
    const longHome = '台北市信義區青年足球聯隊';
    const scene = { ...S4_SCENE_LIVE, match: { ...S4_SCENE_LIVE.match, home: { ...S4_SCENE_LIVE.match.home, name: longHome } } };
    render(<ScorePad {...scene} />);
    expect(tagNames()[0]).toBe(longHome);
    const name = rule('.s4-tag .s4-col__name');
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.s4-tag')).toMatch(/min-width:\s*0/);
    expect(rule('.s4-tags')).toMatch(/height:\s*20px/);
  });

  it('PK、開賽前、終場後都有標籤', () => {
    for (const scene of [S4_SCENE_PK, S4_SCENE_PRE, S4_SCENE_FT]) {
      render(<ScorePad {...scene} />);
      expect(tagNames()).toEqual([scene.match.home.name, scene.match.away.name]);
      cleanup();
    }
    render(<ScorePad {...S4_SCENE_PK} />);
    expect(document.querySelector('.s4-pad .s4-goals--pk')).toBeTruthy();
  });

  it('分隔線在進球／牌區塊內，不在底部控制列', () => {
    render(<ScorePad {...S4_SCENE_LIVE} />);
    const ruleEl = document.querySelector('.s4-pad__rule');
    expect(ruleEl).toBeTruthy();
    expect(ruleEl?.getAttribute('aria-hidden')).toBe('true');
    expect(ruleEl?.parentElement?.classList.contains('s4-pad')).toBe(true);
    expect(ruleEl?.closest('.s4-dock')).toBeNull();
    expect(document.querySelector('.s4-dock .s4-pad__rule')).toBeNull();
    const pad = document.querySelector('.s4-pad')!;
    expect(pad.querySelector('.s4-tags')).toBeTruthy();
    expect(pad.querySelector('.s4-goals')).toBeTruthy();
    expect(pad.querySelector('.s4-cards')).toBeTruthy();
    expect(rule('.s4-pad')).toMatch(/position:\s*relative/);
    const line = rule('.s4-pad__rule');
    expect(line).toMatch(/top:\s*0/);
    expect(line).toMatch(/bottom:\s*0/);
    expect(line).toMatch(/left:\s*50%/);
  });

  it('進球與牌高度不變，深色模式另有標籤色', () => {
    expect(rule('.s4-goals')).toMatch(/height:\s*104px/);
    expect(rule('.s4-cards')).toMatch(/height:\s*56px/);
    expect(css).toMatch(/\[data-theme="dark"\] \.s4-tag\s*\{[^}]*--s4-tag-fg:/);
    expect(css).toMatch(/\[data-theme="dark"\] \.s4-tag--away\s*\{[^}]*--s4-tag-fg:/);
  });
});
