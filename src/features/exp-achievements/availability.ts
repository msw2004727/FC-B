import { t } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import './closed.css';

// 成就／徽章與稱號系統開放開關（2026-10-26 站長：先反灰關閉，點擊顯示「尚未開放」）。
// false：我的頁「成就/徽章」「稱號」按鈕與徽章數、他人名片徽章區與徽章數反灰；/achievements、/titles 不進頁面，導回我的頁並顯示提示。
// 只關前端入口：成就／稱號資料與 Functions 照舊累計（新舊版資料一致）。
// 要恢復時只改這一個常數為 true：元件端的反灰 class（ach-closed）、路由守衛、<html> 上的狀態 class 都由它控制，
// closed.css 的每條規則都綁在這些 class 上，所以開放後不會留下任何反灰。
export const ACHIEVEMENTS_OPEN = false;

/** 掛在 <html> 的狀態 class：控制不在本功能 DOM 內的反灰（他人名片的徽章數統計項，DOM 在 LegacyUserCard.tsx）。 */
export const ACHIEVEMENTS_CLOSED_CLASS = 'achievements-closed';

/** 依開關設定或移除 <html> 的狀態 class。 */
export function syncAchievementsClosedClass(
  open: boolean,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  root?.classList.toggle(ACHIEVEMENTS_CLOSED_CLASS, !open);
}

// 載入這個模組（個人頁、他人名片、路由守衛都會 import）時先套用，早於任何一次 render，避免先亮後灰。
syncAchievementsClosedClass(ACHIEVEMENTS_OPEN);

export function showAchievementsClosedToast(): void {
  toast.show({ message: t('exp-achievements.closed') });
}
