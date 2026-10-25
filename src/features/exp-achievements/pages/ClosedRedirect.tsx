import { useEffect } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { showAchievementsClosedToast } from '../availability';

/**
 * 成就／稱號關閉期間（ACHIEVEMENTS_OPEN=false）/achievements、/titles 的替身頁：
 * 不進成就頁，顯示「尚未開放」後以 replace 導回我的頁（不留下這一筆歷史，返回鍵不會繞回來）。
 */
export default function AchievementsClosedRedirect(): null {
  const { route } = useLocation();
  useEffect(() => {
    showAchievementsClosedToast();
    route('/profile', true);
  }, [route]);
  return null;
}
