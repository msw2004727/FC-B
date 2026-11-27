import { describe, expect, it } from 'vitest';
import { cleanLine, maskedPublicName, surnameOf } from './names';

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
    expect(cleanLine('王\u2066小\u2069明')).toBe('王小明');
    expect(cleanLine('官\u00ad方\u061c協\u180e會')).toBe('官方協會');
    for (const cp of [0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f]) {
      expect(cleanLine(`甲${String.fromCodePoint(cp)}乙`), cp.toString(16)).toBe('甲乙');
    }
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

describe('maskedPublicName（照後端 text.ts）', () => {
  it('漢字遮姓氏後第一個字', () => {
    expect(maskedPublicName('王小明')).toBe('王O明');
    expect(maskedPublicName('歐陽娜娜')).toBe('歐陽O娜');
    expect(maskedPublicName('王明')).toBe('王O');
    expect(maskedPublicName('林')).toBe('林O');
    expect(maskedPublicName('Amy王小美')).toBe('王O美');
    expect(maskedPublicName('歐陽小明')).toBe('歐陽O明');
    expect(maskedPublicName('王小範')).toBe('王O範');
  });

  it('外文多詞留名字首字母，單詞只留首字母加點', () => {
    expect(maskedPublicName('John Smith')).toBe('J. Smith');
    expect(maskedPublicName('Mary Ann Lee')).toBe('M. Lee');
    expect(maskedPublicName('ChenXiaoming')).toBe('C.');
  });

  it('空字串回空字串，結果不等於完整真名', () => {
    expect(maskedPublicName('')).toBe('');
    expect(maskedPublicName('   ')).toBe('');
    for (const name of ['王小明', '歐陽娜娜', '王明', '林', 'Amy王小美', 'John Smith', 'ChenXiaoming']) {
      const full = (cleanLine(name) ?? '').replace(/\s+/g, '');
      expect(maskedPublicName(name), name).not.toBe(full);
    }
  });
});
