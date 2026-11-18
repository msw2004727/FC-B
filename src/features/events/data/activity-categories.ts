/**
 * 活動分類（強度）設定表：建立彈窗、建立表單、活動頁頁籤、卡片底色都讀這一份。
 * 欄位 `intensityLevel` 只寫 `beginner`／`high-intensity`；選「一般」不寫欄位，
 * 缺值或其他值一律當一般（顧問 §3.183）。
 * 之後要加分類：在 ACTIVITY_CATEGORIES 加一筆（先 visible:false 預留不顯示），再補語系與樣式。
 */
export type IntensityLevel = 'beginner' | 'high-intensity';
export type IntensityChoice = '' | IntensityLevel;

export interface ActivityCategory {
  /** 寫進 `intensityLevel` 的值，同時是頁籤鍵（data-atab）。 */
  key: IntensityLevel;
  /** 繁中原文，也是 lt() 的鍵。 */
  label: string;
  /** false：預留位，介面不顯示。 */
  visible: boolean;
}

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  { key: 'beginner', label: '新手友善', visible: true },
  { key: 'high-intensity', label: '高強度', visible: true },
];

export const VISIBLE_ACTIVITY_CATEGORIES: readonly ActivityCategory[] =
  ACTIVITY_CATEGORIES.filter((c) => c.visible);

export function isIntensityLevel(value: unknown): value is IntensityLevel {
  return VISIBLE_ACTIVITY_CATEGORIES.some((c) => c.key === value);
}

/** 讀取容錯：只認目前開放的值，其他一律回 ''（一般）。 */
export function getEventIntensity(event: { intensityLevel?: unknown } | null | undefined): IntensityChoice {
  const raw = event?.intensityLevel;
  return isIntensityLevel(raw) ? raw : '';
}
