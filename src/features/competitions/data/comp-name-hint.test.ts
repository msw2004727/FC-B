import { afterEach, describe, expect, it } from 'vitest';
import { forgetCompNames, recallCompName, rememberCompName } from './comp-name-hint';

afterEach(() => forgetCompNames());

describe('頁首賽事名小字的記憶（第 4 批 3.2）', () => {
  it('以 cid 當鍵：換賽事不串名稱', () => {
    rememberCompName('cup', '示範盃');
    rememberCompName('league', '示範聯賽');
    expect(recallCompName('cup')).toBe('示範盃');
    expect(recallCompName('league')).toBe('示範聯賽');
    expect(recallCompName('other')).toBeUndefined();
  });

  it('空名稱清掉舊值；沒有 cid 不記也不讀', () => {
    rememberCompName('cup', '示範盃');
    rememberCompName('cup', '  ');
    expect(recallCompName('cup')).toBeUndefined();
    rememberCompName('', '示範盃');
    expect(recallCompName('')).toBeUndefined();
  });
});
