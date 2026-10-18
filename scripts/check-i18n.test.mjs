import { describe, expect, it } from 'vitest';
import { checkNamespaces } from './check-i18n.mjs';

const LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko'];

function makeFiles(obj) {
  return Object.fromEntries(LOCALES.map((locale) => [locale, obj]));
}

function makeNamespace(files, name = 'test') {
  return { name, files };
}

describe('checkNamespaces', () => {
  it('基準語系空值會回報錯誤', () => {
    const files = makeFiles({ greeting: 'Hello' });
    files['zh-TW'] = { greeting: '' };
    const errors = checkNamespaces([makeNamespace(files)]);
    expect(errors.some((e) => e.includes('必須是非空字串'))).toBe(true);
  });

  it('非字串會回報錯誤', () => {
    const files = makeFiles({ greeting: 'Hello' });
    files['zh-TW'] = { greeting: null };
    const errors = checkNamespaces([makeNamespace(files)]);
    expect(errors.some((e) => e.includes('必須是非空字串'))).toBe(true);
  });

  it('缺單一語系檔會回報錯誤', () => {
    const files = makeFiles({ greeting: 'Hello' });
    delete files.en;
    const errors = checkNamespaces([makeNamespace(files)]);
    expect(errors.some((e) => e.includes('en.json 缺檔'))).toBe(true);
  });

  it('缺整個 locales（files 缺項）會回報錯誤', () => {
    const errors = checkNamespaces([makeNamespace({})]);
    expect(errors.filter((e) => e.includes('缺檔')).length).toBe(7);
  });

  it('插值參數不同會回報錯誤', () => {
    const files = makeFiles({ greeting: 'Hello {name}' });
    files.en = { greeting: 'Hello {name} {title}' };
    const errors = checkNamespaces([makeNamespace(files)]);
    expect(errors.some((e) => e.includes('插值參數不同'))).toBe(true);
  });

  it('攤平後 key 衝突會回報錯誤', () => {
    const obj = {
      'a.b': 'x',
      a: { b: 'y' },
    };
    const errors = checkNamespaces([makeNamespace(makeFiles(obj))]);
    expect(errors.some((e) => e.includes('key 衝突'))).toBe(true);
  });

  it('全部正確時回傳空陣列', () => {
    const obj = {
      greeting: 'Hello {name}',
      count: {
        one: '{count} item',
        other: '{count} items',
      },
    };
    const errors = checkNamespaces([makeNamespace(makeFiles(obj))]);
    expect(errors).toEqual([]);
  });
});
