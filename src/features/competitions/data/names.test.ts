import { describe, expect, it } from 'vitest';
import { cleanLine, minorPublicNameCandidates, surnameOf } from './names';

describe('cleanLine（照後端 text.ts）', () => {
  it('非字串回 null', () => {
    expect(cleanLine(null)).toBeNull();
    expect(cleanLine(undefined)).toBeNull();
    expect(cleanLine(1)).toBeNull();
    expect(cleanLine({})).toBeNull();
  });

  it('NFKC、去掉不可見字、壓空白、去頭尾', () => {
    expect(cleanLine('  Ａ　b  ')).toBe('A b');
    expect(cleanLine('王\u200b小\ufeff明')).toBe('王小明');
    expect(cleanLine('\u0000林\u2800')).toBe('林');
  });
});

describe('surnameOf（照後端 text.ts）', () => {
  it('中文取第一字，複姓且至少三字取兩字', () => {
    expect(surnameOf('王小明')).toBe('王');
    expect(surnameOf('歐陽娜娜')).toBe('歐陽');
    expect(surnameOf('張簡大華')).toBe('張簡');
    expect(surnameOf('歐陽')).toBe('歐');
    expect(surnameOf('林')).toBe('林');
  });

  it('外文取最後一個詞；空字串回空字串', () => {
    expect(surnameOf('Amy Chen')).toBe('Chen');
    expect(surnameOf('  John   Smith ')).toBe('Smith');
    expect(surnameOf('')).toBe('');
    expect(surnameOf('   ')).toBe('');
  });
});

describe('minorPublicNameCandidates（照後端 text.ts）', () => {
  it('單詞外文名不得等於完整真名，退回首字母加點', () => {
    expect(minorPublicNameCandidates('ChenXiaoming')).toEqual(['C.']);
  });

  it('漢字從第一個漢字起算，含姓氏與前兩字', () => {
    expect(minorPublicNameCandidates('Amy王小美')).toEqual(['王', '王小']);
  });

  it('單字中文名退回該字加點', () => {
    expect(minorPublicNameCandidates('林')).toEqual(['林.']);
  });

  it('候選不得等於完整真名', () => {
    const samples = [
      'ChenXiaoming',
      'Amy王小美',
      '林',
      '歐陽娜娜',
      '王小明',
      'Amy Chen',
      'A',
      '陳',
      '張簡大華',
      'John',
      '王小',
      '',
    ];
    for (const name of samples) {
      const full = (cleanLine(name) ?? '').replace(/\s+/g, '');
      for (const candidate of minorPublicNameCandidates(name)) {
        expect(candidate, name).not.toBe(full);
      }
    }
  });

  it('兩個詞的外文只留最後一個詞；複姓候選含兩字與第一字', () => {
    expect(minorPublicNameCandidates('Amy Chen')).toEqual(['Chen']);
    expect(minorPublicNameCandidates('歐陽娜娜')).toEqual(['歐陽', '歐']);
    expect(minorPublicNameCandidates('王小')).toEqual(['王']);
    expect(minorPublicNameCandidates('')).toEqual([]);
  });
});
