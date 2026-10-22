import type { JSX } from 'preact';

import { lt } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { UNAVAILABLE_MSG } from './profile-legacy-helpers';

export interface UserCardBadgesProps {
  uid: string;
  isSelf: boolean;
}

/**
 * 照 A `showUserProfile` 的「已獲得徽章」區塊（`#uc-badge-container`）與 `.uc-blur-overlay`。
 * 徽章資料層於第 4 段接上；本段只輸出 A 的 DOM 與毛玻璃，點擊先 `toast` 提示。
 * A：`_showBadgesBlur = targetUid && !isSecondaryIdentity && !isSelf && !_badgeCacheHit`，
 *     非 self 且 cache 未命中時以毛玻璃遮蔽。
 * ASSUMPTION: 尚未有 badge cache，`!isSelf` 一律視為未命中 → 顯示毛玻璃。
 */
export function UserCardBadges({ uid, isSelf }: UserCardBadgesProps): JSX.Element {
  // uid 供第 4 段徽章資料層使用；本段不使用，透過 void 避免 unused 警告。
  void uid;

  const showBlur = !isSelf;

  const handleBlurClick = (): void => {
    toast.show({ message: UNAVAILABLE_MSG });
  };

  return (
    <div class="info-card">
      <div class="info-title">{lt('已獲得徽章', '已獲得徽章')}</div>
      <div id="uc-badge-container">
        <div style="font-size:.82rem;color:var(--text-muted)">
          {lt('尚未獲得徽章', '尚未獲得徽章')}
        </div>
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
