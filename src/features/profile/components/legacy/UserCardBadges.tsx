import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { BadgeDef } from '@/features/exp-achievements/data/achievements';
import {
  ACHIEVEMENTS_OPEN,
  showAchievementsClosedToast,
} from '@/features/exp-achievements/availability';
import { lt, useT } from '@/i18n/i18n';

export interface UserCardBadgesProps {
  uid: string;
  isSelf: boolean;
}

interface EarnedBadge {
  badge: BadgeDef;
  color: string;
}

// 動態載入包成模組層快取（fcb-accept：並行 await import() 時 vi.mock 可能只套到第一次）。
let achievementsModule: Promise<typeof import('@/features/exp-achievements/data/achievements')> | null = null;
function loadAchievementsModule(): Promise<typeof import('@/features/exp-achievements/data/achievements')> {
  achievementsModule ??= import('@/features/exp-achievements/data/achievements');
  return achievementsModule;
}

/**
 * 照 A `showUserProfile` 的「已獲得徽章」區塊（`#uc-badge-container`）。
 * 本人直接載入；非本人先遮毛玻璃，點擊後才讀 `users/{targetUid}/achievements`。
 * 載入失敗顯示空狀態；資料層動態 import，不進首屏 bundle。
 * 成就系統關閉期間（ACHIEVEMENTS_OPEN=false）改顯示反灰的 UserCardBadgesClosed，不讀任何徽章資料。
 */
export function UserCardBadges(props: UserCardBadgesProps): JSX.Element {
  return ACHIEVEMENTS_OPEN ? <UserCardBadgesLive {...props} /> : <UserCardBadgesClosed />;
}

/**
 * 關閉期間：保留區塊標題，整塊反灰；點擊只顯示「尚未開放」，不載入徽章。
 * 可操作的是卡片裡的原生 button（承載可見的關閉說明；可聚焦，Enter／Space 由瀏覽器轉成 click）；
 * 卡片本身的 onClick 只是讓滑鼠點整塊也有回應，button 的 click 會冒泡到這裡，所以只處理一次。
 * 個人頁在 .legacy-ui 內，文字不用 <Text>（FC-B CLAUDE.md：A 外觀頁面不用 <Text>）。
 */
function UserCardBadgesClosed(): JSX.Element {
  const t = useT();
  return (
    <div class="info-card ach-closed" onClick={showAchievementsClosedToast}>
      <div class="info-title">{lt('已獲得徽章', '已獲得徽章')}</div>
      <div id="uc-badge-container">
        <button type="button" class="ach-closed-note" aria-disabled="true">
          {t('exp-achievements.closed')}
        </button>
      </div>
    </div>
  );
}

function UserCardBadgesLive({ uid, isSelf }: UserCardBadgesProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestSeq = useRef(0);

  const load = async (targetUid: string): Promise<void> => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(false);
    try {
      const mod = await loadAchievementsModule();
      const [defs, progressMap] = await Promise.all([
        mod.loadAchievementDefs(),
        mod.loadUserAchievementProgress(targetUid),
      ]);
      if (seq !== requestSeq.current) return;
      const evaluated = mod.evaluateFromProgress(defs.achievements, progressMap);
      const { completed } = mod.splitPendingCompleted(evaluated);
      const earned = mod
        .getEarnedBadges(completed, defs.badges)
        .map(({ badge, color }) => ({ badge, color }));
      setBadges(earned);
      setLoaded(true);
      setError(false);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      // 讀取失敗不顯示空狀態，保留重試入口。
      setBadges([]);
      setLoaded(false);
      setError(true);
      // eslint-disable-next-line no-console
      console.warn('[profile] load user card badges failed', err);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  // 照 A：本人不遮，直接載入；uid 切換時重設並作廢舊請求。
  useEffect(() => {
    requestSeq.current += 1;
    setBadges([]);
    setLoaded(false);
    setError(false);
    setLoading(false);
    if (isSelf) {
      void load(uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelf, uid]);

  const showBlur = !isSelf && !loaded;

  const handleRetry = (): void => {
    if (loading) return;
    void load(uid);
  };

  const handleBlurClick = (): void => {
    handleRetry();
  };

  return (
    <div class="info-card">
      <div class="info-title">{lt('已獲得徽章', '已獲得徽章')}</div>
      <div id="uc-badge-container">
        {error ? (
          <div
            style="font-size:.82rem;color:var(--text-muted);cursor:pointer"
            onClick={handleRetry}
          >
            {lt('徽章載入失敗', '徽章載入失敗')}
          </div>
        ) : loaded && badges.length > 0 ? (
          <div class="uc-badge-list">
            {badges.map(({ badge, color }) => (
              <div class="uc-badge-item" key={badge.id}>
                <div class="badge-img-placeholder" style={`border-color:${color}`}>
                  {badge.image ? (
                    <img src={badge.image} alt={badge.name} loading="lazy" />
                  ) : null}
                </div>
                <span class="uc-badge-name">{badge.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style="font-size:.82rem;color:var(--text-muted)">
            {lt('尚未獲得徽章', '尚未獲得徽章')}
          </div>
        )}
      </div>
      {showBlur ? (
        <div class="uc-blur-overlay" onClick={handleBlurClick}>
          <div class="uc-blur-text">
            {error
              ? lt('徽章載入失敗', '徽章載入失敗')
              : lt('點擊載入此用戶的徽章', '點擊載入此用戶的徽章')}
          </div>
        </div>
      ) : null}
    </div>
  );
}
