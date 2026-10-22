import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import type { BadgeDef } from '@/features/exp-achievements/data/achievements';
import { lt } from '@/i18n/i18n';

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
 */
export function UserCardBadges({ uid, isSelf }: UserCardBadgesProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    try {
      const mod = await loadAchievementsModule();
      const [defs, progressMap] = await Promise.all([
        mod.loadAchievementDefs(),
        mod.loadUserAchievementProgress(uid),
      ]);
      const evaluated = mod.evaluateFromProgress(defs.achievements, progressMap);
      const { completed } = mod.splitPendingCompleted(evaluated);
      const earned = mod
        .getEarnedBadges(completed, defs.badges)
        .map(({ badge, color }) => ({ badge, color }));
      setBadges(earned);
      setLoaded(true);
    } catch (err) {
      setLoaded(true);
      // eslint-disable-next-line no-console
      console.warn('[profile] load user card badges failed', err);
    } finally {
      setLoading(false);
    }
  };

  // 照 A：本人不遮，直接載入。
  useEffect(() => {
    if (isSelf) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelf, uid]);

  const showBlur = !isSelf && !loaded;

  const handleBlurClick = (): void => {
    void load();
  };

  return (
    <div class="info-card">
      <div class="info-title">{lt('已獲得徽章', '已獲得徽章')}</div>
      <div id="uc-badge-container">
        {loaded && badges.length > 0 ? (
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
            {lt('點擊載入此用戶的徽章', '點擊載入此用戶的徽章')}
          </div>
        </div>
      ) : null}
    </div>
  );
}
