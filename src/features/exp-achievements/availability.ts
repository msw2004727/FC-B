import { t } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import './closed.css';

// 成就／徽章與稱號系統開放開關（2026-10-26 站長：先反灰關閉，點擊顯示「尚未開放」）。
// false：我的頁「成就/徽章」「稱號」按鈕與徽章數、他人名片徽章區反灰；/achievements、/titles 不進頁面，導回我的頁並顯示提示。
// 只關前端入口：成就／稱號資料與 Functions 照舊累計（新舊版資料一致）。
// 要恢復時改 true，並刪除 closed.css 裡的 #uc-stat-badges 規則（他人名片徽章數的 DOM 在 LegacyUserCard.tsx，不受這個開關控制）。
export const ACHIEVEMENTS_OPEN = false;

export function showAchievementsClosedToast(): void {
  toast.show({ message: t('exp-achievements.closed') });
}
