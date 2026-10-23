import { describe, expect, it } from 'vitest';

import {
  TW_REGIONS,
  TW_REGIONS_WITH_OTHER,
  filterTwRegions,
} from './taiwan-regions';

describe('台灣地區：對應 A js/config.js', () => {
  it('22 縣市順序逐項一致，其他只附加在末尾', () => {
    expect(TW_REGIONS).toEqual([
      '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
      '基隆市', '新竹市', '嘉義市',
      '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
      '屏東縣', '宜蘭縣', '花蓮縣', '台東縣',
      '澎湖縣', '金門縣', '連江縣',
    ]);
    expect(TW_REGIONS).toHaveLength(22);
    expect(TW_REGIONS_WITH_OTHER).toEqual([...TW_REGIONS, '其他']);
  });

  it('空查詢回傳全部的新副本，不修改來源', () => {
    for (const keyword of ['', ' \t\n ', null, undefined]) {
      const result = filterTwRegions(keyword);
      expect(result).toEqual(TW_REGIONS_WITH_OTHER);
      expect(result).not.toBe(TW_REGIONS_WITH_OTHER);
      result.pop();
      expect(TW_REGIONS_WITH_OTHER).toHaveLength(23);
    }

    const withoutOther = filterTwRegions('', false);
    expect(withoutOther).toEqual(TW_REGIONS);
    expect(withoutOther).not.toBe(TW_REGIONS);
  });

  it('臺台互通、修剪空白、依序但不必連續', () => {
    expect(filterTwRegions(' 臺市 ')).toEqual(['台北市', '台中市', '台南市']);
    expect(filterTwRegions('新縣')).toEqual(['新竹縣']);
    expect(filterTwRegions('竹新')).toEqual([]);
    expect(filterTwRegions('台台')).toEqual([]);
    expect(filterTwRegions('不存在')).toEqual([]);
  });

  it('其他預設納入，false 排除；英文字母大小寫結果一致', () => {
    expect(filterTwRegions('其')).toEqual(['其他']);
    expect(filterTwRegions('其', false)).toEqual([]);
    expect(filterTwRegions('TAI')).toEqual(filterTwRegions('tai'));
    expect(filterTwRegions('TAI')).toEqual([]);
  });
});
