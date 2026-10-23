// 對應 A js/config.js:TW_REGIONS
export const TW_REGIONS: readonly string[] = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
  '屏東縣', '宜蘭縣', '花蓮縣', '台東縣',
  '澎湖縣', '金門縣', '連江縣',
];

// 對應 A js/config.js:TW_REGIONS_WITH_OTHER
export const TW_REGIONS_WITH_OTHER: readonly string[] = [
  ...TW_REGIONS,
  '其他',
];

// 對應 A js/config.js:filterTwRegions
export function filterTwRegions(keyword: unknown, includeOther = true): string[] {
  const list = includeOther ? TW_REGIONS_WITH_OTHER : TW_REGIONS;
  const query = String(keyword || '').trim().replace(/臺/g, '台').toLowerCase();
  if (!query) return [...list];

  return list.filter((name) => {
    const text = name.replace(/臺/g, '台').toLowerCase();
    let cursor = 0;
    for (const character of query) {
      const index = text.indexOf(character, cursor);
      if (index < 0) return false;
      cursor = index + 1;
    }
    return true;
  });
}
