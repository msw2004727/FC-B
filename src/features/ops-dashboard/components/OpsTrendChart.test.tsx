import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { setLocale } from '@/i18n/i18n';
import { LOCALES } from '@/i18n/locales';

import type { TrendDaily } from '../data/ops-summary-types';
import { OPS_STRINGS, opsT, type OpsStringKey } from '../ops-strings';
import { OpsTrendChart, type OpsTrendChartProps } from './OpsTrendChart';

const featureDir = resolve('src/features/ops-dashboard');
const css = readFileSync(resolve(featureDir, 'ops-dashboard.css'), 'utf8');
const indexSource = readFileSync(resolve(featureDir, 'index.ts'), 'utf8');

function day(d: string, patch: Partial<TrendDaily> = {}): TrendDaily {
  return {
    d,
    active7: 0,
    active30: 0,
    newUsers: 0,
    eventsHeld: 0,
    registrations: 0,
    completed: 0,
    counted: 0,
    countedEvents: 0,
    ...patch,
  };
}

function props(patch: Partial<OpsTrendChartProps> = {}): OpsTrendChartProps {
  return {
    period: 'd7',
    asOf: '2026-11-08',
    periodBlock: {
      start: '2026-11-07',
      end: '2026-11-08',
      prevStart: '2026-11-05',
      prevEnd: '2026-11-06',
      complete: true,
      prevComplete: true,
      kpi: {
        activeUsers: { cur: null, prev: null },
        newUsers: { cur: 0, prev: null },
        eventsHeld: { cur: 0, prev: null },
        registrations: { cur: 0, prev: null },
        attend: {
          completed: 0, counted: 0, countedEvents: 0,
          prevCompleted: 0, prevCounted: 0, prevCountedEvents: 0,
        },
      },
      topEvents: [],
      topHosts: [],
    },
    daily: [
      day('2026-11-07', { active7: 10, newUsers: 1, eventsHeld: 2 }),
      day('2026-11-08', { active7: 14, newUsers: 4, eventsHeld: 5 }),
    ],
    monthly: [{ m: '2026-11', active30: 32, newUsers: 4, eventsHeld: 5, registrations: 0, completed: 0, counted: 0, countedEvents: 0 }],
    noshowDaily: [],
    noshowMonthly: [],
    showNoShow: true,
    t: opsT,
    ...patch,
  };
}

/** 泰文上／下加符沒有前進寬度。 */
function isZeroAdvance(code: number): boolean {
  return code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
}

/** CJK、假名、諺文音節、全形、泰文基底（含前置母音）。越南預組字不算全形。 */
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

/** 粗體（700）估算：全形 1em、空白 0.34em、其餘拉丁（含越南文）0.66em。 */
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

/** 外殼 #main-content 是 border-box。600px 起左右 16px，800px 起最寬 640。 */
function buttonTextBox(viewport: number, columns: number): number {
  const pad = viewport >= 600 ? 16 : 8;
  const max = viewport >= 800 ? 640 : 560;
  const content = Math.min(viewport, max) - pad * 2;
  const inner = content - 0.85 * 16 * 2;
  const cell = (inner - 4 * (columns - 1)) / columns;
  return cell - 0.1 * 16 * 2 - 2;
}

beforeAll(async () => {
  await setLocale('zh-TW');
});

afterEach(() => cleanup());

afterAll(async () => {
  await setLocale('zh-TW');
});

describe('OpsTrendChart', () => {
  it('切換指標、點擊與滑過顯示日期和數值；活躍才有口徑小字', () => {
    const view = render(<OpsTrendChart {...props()} />);
    const root = view.container.querySelector('[data-trend]') as HTMLElement;
    expect(root.getAttribute('data-metric')).toBe('active');
    expect(root.querySelector('[data-trend-readout]')?.textContent).toContain('7 日活躍');
    expect(root.querySelector('.od-trend-line')).toBeTruthy();

    const hit = root.querySelector('[data-point="2026-11-08"]') as Element;
    fireEvent.pointerEnter(hit);
    expect(root.querySelector('[data-trend-readout]')?.textContent).toContain('2026/11/08 14');
    fireEvent.pointerLeave(hit);
    expect(root.querySelector('[data-trend-readout]')?.textContent).not.toContain('14');

    fireEvent.click(hit);
    expect(root.querySelector('[data-trend-readout]')?.textContent).toContain('2026/11/08 14');
    expect(root.querySelector('[data-trend-readout]')?.textContent).toContain('7 日活躍');

    fireEvent.click(root.querySelector('[data-metric="held"]') as Element);
    expect(root.getAttribute('data-metric')).toBe('held');
    expect(root.querySelector('[data-trend-readout]')?.textContent).not.toContain('7 日活躍');
    fireEvent.click(root.querySelector('[data-point="2026-11-08"]') as Element);
    expect(root.querySelector('[data-trend-readout]')?.textContent).toContain('2026/11/08 5');

    view.rerender(<OpsTrendChart {...props({ period: 'm12' })} />);
    expect(root.getAttribute('data-period')).toBe('m12');
    expect(root.getAttribute('data-metric')).toBe('held');
    expect(root.querySelector('[data-trend-readout]')?.textContent ?? '').not.toContain('日活躍');
    fireEvent.click(root.querySelector('[data-metric="active"]') as Element);
    expect(root.querySelector('[data-trend-readout]')?.textContent).toContain('30 日活躍');
    expect(root.querySelector('[data-trend-readout]')?.textContent).not.toContain('7 日活躍');
  });

  it('整段全 0 是空狀態；切到有資料的指標才畫線；沒有放鴿子權限不出現該鈕', () => {
    const view = render(<OpsTrendChart {...props({
      daily: [
        day('2026-11-07', { active7: 0, eventsHeld: 3 }),
        day('2026-11-08', { active7: 0, eventsHeld: 4 }),
      ],
      showNoShow: false,
    })} />);
    const root = view.container.querySelector('[data-trend]') as HTMLElement;
    expect(root.getAttribute('data-trend-status')).toBe('empty');
    expect(root.querySelector('.od-trend-line')).toBeNull();
    expect(root.textContent).toContain('查無資料');
    expect(root.querySelector('[data-metric="noshow"]')).toBeNull();
    fireEvent.click(root.querySelector('[data-metric="held"]') as Element);
    expect(root.getAttribute('data-trend-status')).toBe('ready');
    expect(root.querySelector('.od-trend-line')).toBeTruthy();
  });

  it('只有一個點時不畫線', () => {
    const view = render(<OpsTrendChart {...props({
      daily: [day('2026-11-08', { active7: 6 })],
      periodBlock: props().periodBlock && { ...props().periodBlock!, start: '2026-11-01', end: '2026-11-08' },
    })} />);
    const svg = view.container.querySelector('.od-trend-svg') as SVGElement;
    expect(svg.getAttribute('data-single')).toBe('1');
    expect(svg.getAttribute('data-lines')).toBe('0');
    expect(svg.getAttribute('data-dots')).toBe('1');
  });

  it('trend 陣列是空的時整塊不顯示', () => {
    const view = render(<OpsTrendChart {...props({ daily: [], monthly: [] })} />);
    expect(view.container.querySelector('[data-trend]')).toBeNull();
  });

  it('深色與淺色都用既有 token，不寫死色值', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const view = render(<OpsTrendChart {...props()} />);
    const html = view.container.innerHTML;
    expect(view.container.querySelector('.od-trend')).toBeTruthy();
    expect(view.container.querySelector('.od-trend-area')).toBeTruthy();
    expect(view.container.querySelector('.od-trend-line')?.getAttribute('stroke')).toBe('var(--accent)');
    expect(html).toContain('var(--border)');
    expect(html).toContain('var(--text-muted)');
    expect(html).toContain('var(--bg-card)');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    document.documentElement.setAttribute('data-theme', 'light');
    view.rerender(<OpsTrendChart {...props()} />);
    expect(view.container.querySelector('.od-trend-line')?.getAttribute('stroke')).toBe('var(--accent)');
    const trendCss = css.slice(css.indexOf('/* 趨勢圖（§2.3）'));
    expect(trendCss).toMatch(/\[data-theme="dark"\][^{]*\.od-trend-area/);
    expect(trendCss).toMatch(/\.od-trend-metrics button \{[^}]*white-space:\s*nowrap/);
    expect(trendCss).toMatch(/\.od-trend-svg \{[^}]*max-width:\s*100%/);
    expect(trendCss).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    document.documentElement.removeAttribute('data-theme');
  });

  it('圖表不進首頁入口的靜態 import', () => {
    expect(indexSource).not.toContain('ops-trend');
    expect(indexSource).not.toContain('OpsTrendChart');
    expect(indexSource).toContain("import('./pages/OpsPage')");
  });

  it('390／375 三欄與 760 六欄，七語系按鈕與口徑都放得下且沒有手動斷行', () => {
    const labels: OpsStringKey[] = ['kpi.active', 'kpi.new', 'kpi.held', 'kpi.regs', 'kpi.attend', 'kpi.noshow', 'active7', 'active30'];
    const font = 0.72 * 16;
    const boxes = [
      ['375 三欄', buttonTextBox(375, 3)],
      ['390 三欄', buttonTextBox(390, 3)],
      ['760 六欄', buttonTextBox(760, 6)],
      ['1280 六欄', buttonTextBox(1280, 6)],
    ] as const;
    for (const locale of LOCALES) {
      for (const key of labels) {
        const text = OPS_STRINGS[locale][key];
        expect(text.includes('\n'), `${locale}.${key}`).toBe(false);
        const width = textPx(text, font);
        for (const [name, box] of boxes) {
          if (key === 'active7' || key === 'active30') continue;
          expect(width, `${locale}.${key} @ ${name} ${width.toFixed(1)} > ${box.toFixed(1)}`).toBeLessThan(box);
        }
        const row = buttonTextBox(375, 1);
        if (key === 'active7' || key === 'active30') {
          expect(width, `${locale}.${key}`).toBeLessThan(row);
        }
      }
    }
  });
});
