import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 計畫書 §7.2／驗收 6：九宮格開著時（body.sport-prefs-open，由 SportPrefsModal 掛載時加、卸載時移除）安裝浮球與聯繫站長泡泡讓開。
describe('九宮格開著時浮球與泡泡讓開', () => {
  it('樣式隱藏安裝浮球、聯繫站長與兩個提示泡泡', () => {
    const css = readFileSync(join(__dirname, 'sport-prefs.css'), 'utf8');
    for (const cls of ['pwa-install-fab', 'pwa-install-fab-hint', 'contact-owner-fab', 'contact-owner-fab-hint']) {
      expect(css).toContain(`body.sport-prefs-open .${cls}`);
    }
    expect(css).toMatch(/body\.sport-prefs-open \.contact-owner-fab-hint \{ display: none !important; \}/);
  });
});

describe('確認鈕存檔中轉圈', () => {
  it('沿用共用 ui-spin 動畫與時長 token，且 reduced motion 停轉', () => {
    const css = readFileSync(join(__dirname, 'sport-prefs.css'), 'utf8');
    expect(css).toMatch(/\.spf-ok-spin \{[^}]*animation: ui-spin var\(--ui-spin-dur\) var\(--ui-ease\) infinite;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*#sport-prefs-modal \.spf-ok-spin \{ animation: none; \}/);
    expect(css).not.toMatch(/@keyframes/);
  });
});
