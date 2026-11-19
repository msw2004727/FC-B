import { describe, expect, it } from 'vitest';
import { readHandoffParams, unwrapPageUrl } from './handoff-url';

const ID = 'ab'.repeat(32);
const O = 'https://next.toosterx.com';

describe('readHandoffParams', () => {
  it('最外層形式', () => {
    const r = readHandoffParams(`${O}/?fcbHandoff=${ID}&code=c1&liffClientId=9&liffRedirectUri=${encodeURIComponent(`${O}/?fcbHandoff=${ID}`)}`);
    expect(r).toEqual({ present: true, handoffId: ID, code: 'c1', liffClientId: '9', liffRedirectUri: `${O}/?fcbHandoff=${ID}` });
  });

  it('liff.state 包裹形式（站長截圖）：fcbHandoff 從 liff.state 取，code 等從最外層取', () => {
    const wrapped = `${O}/?liff.state=${encodeURIComponent(`?fcbHandoff=${ID}`)}`;
    const href = `${O}/?liff.state=${encodeURIComponent(`?fcbHandoff=${ID}`)}&state=s&liffClientId=2009084941&liffRedirectUri=${encodeURIComponent(wrapped)}&code=c2`;
    expect(readHandoffParams(href)).toEqual({ present: true, handoffId: ID, code: 'c2', liffClientId: '2009084941', liffRedirectUri: wrapped });
  });

  it('格式不對的 id：present true、handoffId null；沒有 fcbHandoff：present false', () => {
    expect(readHandoffParams(`${O}/?fcbHandoff=XYZ`)).toMatchObject({ present: true, handoffId: null });
    expect(readHandoffParams(`${O}/?code=c&liffClientId=1`)).toMatchObject({ present: false, handoffId: null });
  });

  it('liff.state 指向他站時不採用其中的參數', () => {
    expect(readHandoffParams(`${O}/?liff.state=${encodeURIComponent(`https://evil.example/?fcbHandoff=${ID}`)}`).present).toBe(false);
  });
});

describe('unwrapPageUrl', () => {
  it('還原 liff.state 的路徑與 query，補回最外層參數，拿掉 fcbHandoff 與 liff.state', () => {
    const href = `${O}/?liff.state=${encodeURIComponent(`/events/7?tab=2&fcbHandoff=${ID}`)}&code=c&liffClientId=9`;
    const u = unwrapPageUrl(href);
    expect(u?.pathname).toBe('/events/7');
    expect(u?.searchParams.get('tab')).toBe('2');
    expect(u?.searchParams.get('code')).toBe('c');
    expect(u?.searchParams.has('fcbHandoff')).toBe(false);
    expect(u?.searchParams.has('liff.state')).toBe(false);
  });

  it('沒有 liff.state：只拿掉 fcbHandoff', () => {
    const u = unwrapPageUrl(`${O}/p?fcbHandoff=${ID}&x=1`);
    expect(u?.toString()).toBe(`${O}/p?x=1`);
  });

  it('liff.state 指向他站：null', () => {
    expect(unwrapPageUrl(`${O}/?liff.state=${encodeURIComponent('https://evil.example/')}`)).toBeNull();
  });
});
