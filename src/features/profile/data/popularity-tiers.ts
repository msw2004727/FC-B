/**
 * 站長 2026-11-10：規則靠改這個檔案調整，不做後台設定。
 * 改規則＝改這個檔＋跑測試＋上線。
 *
 * 星等是階梯：人數達到該階下限才升，不到維持上一階。10000 以上維持 5。
 * 稱號暫定五段，依星數整數段：0～0.5 新面孔、1～1.5 小有名氣、2～2.5 人氣新星、3～3.5 熱門人物、4～5 球場焦點。
 */

/** 人數下限 → 星數（0.5 顆一階）。須由小到大。 */
export const POPULARITY_STEPS: readonly (readonly [minViews: number, stars: number])[] = [
  [0, 0],
  [50, 0.5],
  [100, 1],
  [250, 1.5],
  [500, 2],
  [1000, 2.5],
  [2000, 3],
  [3000, 3.5],
  [5000, 4],
  [7500, 4.5],
  [10000, 5],
];

/** 五段稱號，索引 0 對應 0 星段，索引 4 對應 4～5 星。 */
export const POPULARITY_TIER_NAMES = ['新面孔', '小有名氣', '人氣新星', '熱門人物', '球場焦點'] as const;

export type PopularityTierName = (typeof POPULARITY_TIER_NAMES)[number];

/**
 * 已達到的最高階星數。
 * 非 number、非有限數（NaN／Infinity）、負數一律當 0 星；其餘先無條件捨去小數再比對門檻。
 */
export function popularityStars(views: unknown): number {
  if (typeof views !== 'number' || !Number.isFinite(views) || views < 0) return 0;
  const reached = Math.trunc(views);
  let stars = 0;
  for (const [minViews, stepStars] of POPULARITY_STEPS) {
    if (reached >= minViews) stars = stepStars;
    else break;
  }
  return stars;
}

/** 依星數落在哪一段稱號。防呆與 `popularityStars` 相同。 */
export function popularityTier(views: unknown): PopularityTierName {
  const stars = popularityStars(views);
  const index = Math.min(POPULARITY_TIER_NAMES.length - 1, Math.max(0, Math.floor(stars)));
  return POPULARITY_TIER_NAMES[index] ?? POPULARITY_TIER_NAMES[0];
}
