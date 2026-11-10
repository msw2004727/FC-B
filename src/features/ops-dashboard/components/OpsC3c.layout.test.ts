// C3c 新文字：390／375／1280 不換行、不溢出（粗體寬度估算，同趨勢圖測試）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/i18n/locales';

import { OPS_STRINGS, type OpsStringKey } from '../ops-strings';

const featureDir = resolve('src/features/ops-dashboard');
const css = readFileSync(resolve(featureDir, 'ops-dashboard.css'), 'utf8');
const indexSource = readFileSync(resolve(featureDir, 'index.ts'), 'utf8');

function isZeroAdvance(code: number): boolean {
  return code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
}

function isWide(code: number): boolean {
  if (code >= 0x1100 && code <= 0x11ff) return true;
  if (code >= 0x2e80 && code <= 0x9fff) return true;
  if (code >= 0xac00 && code <= 0xd7af) return true;
  if (code >= 0xf900 && code <= 0xfaff) return true;
  if (code >= 0xff00 && code <= 0xff60) return true;
  if (code >= 0x3040 && code <= 0x30ff) return true;
  if (code >= 0x0e00 && code <= 0x0e7f) return !isZeroAdvance(code);
  return false;
}

function textPx(text: string, fontPx: number): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === ' ') width += fontPx * 0.34;
    else if (isZeroAdvance(code)) width += 0;
    else if (isWide(code)) width += fontPx;
    else width += fontPx * 0.66;
  }
  return width;
}

function contentWidth(viewport: number): number {
  const pad = viewport >= 600 ? 16 : 8;
  const max = viewport >= 800 ? 640 : 560;
  return Math.min(viewport, max) - pad * 2;
}

/** 費用卡在 .od-card 裡三欄。 */
function costCell(viewport: number): number {
  const inner = contentWidth(viewport) - 0.85 * 16 * 2;
  const gap = 0.35 * 16;
  return (inner - gap * 2) / 3;
}

describe('C3c 一行與不進首頁入口', () => {
  it('新文字沒有手動斷行；費用標籤、排行卡名、空日提示在 375／390／1280 放得下', () => {
    const labels: OpsStringKey[] = ['costMtd', 'costProjected', 'costPrev'];
    const titles: OpsStringKey[] = ['rankEvents', 'rankHosts', 'noDay'];
    const viewports = [375, 390, 1280];
    for (const locale of LOCALES) {
      for (const key of [...labels, ...titles, 'rankHostVal' as const]) {
        expect(OPS_STRINGS[locale][key].includes('\n'), `${locale}.${key}`).toBe(false);
      }
      for (const viewport of viewports) {
        const cell = costCell(viewport);
        for (const key of labels) {
          const width = textPx(OPS_STRINGS[locale][key], 0.74 * 16);
          expect(width, `${locale}.${key} @ ${viewport}`).toBeLessThan(cell);
        }
        const titleBox = contentWidth(viewport) - 0.85 * 16 * 2;
        for (const key of ['rankEvents', 'rankHosts'] as const) {
          expect(textPx(OPS_STRINGS[locale][key], 0.78 * 16), `${locale}.${key}`).toBeLessThan(titleBox);
        }
        expect(textPx(OPS_STRINGS[locale].noDay, 0.82 * 16), `${locale}.noDay`).toBeLessThan(contentWidth(viewport));
        const sample = OPS_STRINGS[locale].rankHostVal.replace('{events}', '99').replace('{regs}', '9,999');
        const valueWidth = textPx(sample, 0.78 * 16);
        const rowChrome = (1.6 + 1.9 + 0.55 * 3) * 16;
        expect(valueWidth + rowChrome, `${locale} host value @ ${viewport}`).toBeLessThan(contentWidth(viewport) - 0.85 * 16 * 2);
      }
    }
  });

  it('排行與費用文字 nowrap，且不進首頁入口的靜態 import', () => {
    expect(css).toMatch(/\.od-rank-head \{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.od-cost-label \{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.od-cost-num \{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.od-rank-title \{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.od-rank-val \{[^}]*white-space:\s*nowrap/);
    expect(indexSource).not.toContain('ops-rank');
    expect(indexSource).not.toContain('OpsCostCard');
    expect(indexSource).not.toContain('OpsRankCard');
    expect(indexSource).toContain("import('./pages/OpsPage')");
  });
});
