import { cleanup, render } from '@testing-library/preact';
import type { JSX } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '../i18n';
import { CpFrame } from './shell';

// 新外觀卡 1b-2：頁首的兩個選用參數（第 3、4 批引用）。
beforeAll(async () => {
  await loadCompetitionsDict(getCurrentLocale());
});
afterEach(cleanup);

function top(node: JSX.Element) {
  const view = render(<LocationProvider>{node}</LocationProvider>);
  return view.container.querySelector('header.cps-top') as HTMLElement;
}

describe('CpFrame 頁首', () => {
  it('沒有 crumb、context：照舊是返回鈕＋h1', () => {
    const header = top(<CpFrame title="報隊管理"><p>內容</p></CpFrame>);
    expect(header.querySelector('h1')?.textContent).toBe('報隊管理');
    expect(header.querySelector('.cps-top__crumb')).toBeNull();
    expect(header.querySelector('.cps-top__ctx')).toBeNull();
  });

  it('crumb：返回鈕旁小字、頁首不畫 h1', () => {
    const header = top(<CpFrame title="賽事詳情" crumb="賽事"><h1>春季盃</h1></CpFrame>);
    expect(header.querySelector('h1')).toBeNull();
    const crumb = header.querySelector('.cps-top__crumb');
    expect(crumb?.textContent).toBe('賽事');
    expect(crumb?.previousElementSibling?.className).toBe('cps-iconbtn');
  });

  it('context：賽事名小字接在 h1 後面、不在 h1 裡面，menu 排在最後', () => {
    const header = top(
      <CpFrame title="本隊名單" context="春季盃" menu={<button type="button" class="cps-iconbtn" aria-label="更多" />}>
        <p>內容</p>
      </CpFrame>,
    );
    const h1 = header.querySelector('h1');
    expect(h1?.textContent).toBe('本隊名單');
    const ctx = h1?.nextElementSibling;
    expect(ctx?.className).toBe('cps-top__ctx');
    expect(ctx?.textContent).toBe('春季盃');
    expect(ctx?.nextElementSibling?.getAttribute('aria-label')).toBe('更多');
  });
});
