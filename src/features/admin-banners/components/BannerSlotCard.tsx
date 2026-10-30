import type { JSX } from 'preact';
import { useT } from '@/i18n/i18n';
import {
  bannerCardActions,
  bannerImageSrc,
  remainDays,
  type BannerCardAction,
  type BannerSlot,
} from '../data/banner-model';

export interface BannerSlotCardProps {
  slot: BannerSlot;
  nowMs: number;
  /** 與寫入函式同一個 `canManageBanners` 判斷（R-IAM-011）；false 時不畫任何操作按鈕。 */
  canManage: boolean;
  busy: boolean;
  onAction(action: BannerCardAction, slot: BannerSlot): void;
}

// A `_adActionBtns`：按鈕共用的內聯樣式與顏色。
const BTN_STYLE = 'font-size:.72rem;padding:.2rem .5rem';
const ACTION_STYLE: Record<BannerCardAction, string> = {
  edit: BTN_STYLE,
  delist: `${BTN_STYLE};color:var(--danger)`,
  relist: `${BTN_STYLE};color:var(--success)`,
  clear: `${BTN_STYLE};color:var(--danger)`,
};

/** 照 A `renderBannerManage` 的單張廣告位卡（DOM、class、文案相同）。 */
export function BannerSlotCard({
  slot,
  nowMs,
  canManage,
  busy,
  onAction,
}: BannerSlotCardProps): JSX.Element {
  const t = useT();
  const isEmpty = slot.status === 'empty';
  const isActive = slot.status === 'active';
  const isScheduled = slot.status === 'scheduled';
  const isPermanent = !isEmpty && !slot.unpublishAt;
  const statusLabel = isEmpty
    ? t('admin-banners.card.statusEmpty')
    : isActive
      ? t('admin-banners.card.statusActive')
      : isScheduled
        ? t('admin-banners.card.statusScheduled')
        : t('admin-banners.card.statusExpired');
  const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
  const timeInfo = isEmpty
    ? t('admin-banners.card.timeEmpty')
    : slot.publishAt && slot.unpublishAt
      ? `${slot.publishAt} ~ ${slot.unpublishAt}`
      : slot.publishAt
        ? `${slot.publishAt} ~ ${t('admin-banners.card.forever')}`
        : t('admin-banners.card.timeNotSet');
  const remainText = isActive
    ? isPermanent
      ? t('admin-banners.card.forever')
      : t('admin-banners.card.remain', { days: remainDays(slot.unpublishAt, nowMs) })
    : '';
  const slotLabel = slot.slotName || t('admin-banners.card.defaultSlotName', { slot: slot.slot });
  const actions = canManage ? bannerCardActions(slot, nowMs) : [];
  // F12：資料裡的 image 保留原值；只有能安全顯示的（http/https）才畫縮圖。
  const imageSrc = bannerImageSrc(slot.image);

  return (
    <div class="banner-manage-card" style="margin-bottom:.5rem" data-banner-id={slot.id}>
      {imageSrc ? (
        <div class="banner-thumb" style="overflow:hidden">
          <img src={imageSrc} alt="" style="width:100%;height:100%;object-fit:cover" />
        </div>
      ) : (
        <div class="banner-thumb banner-thumb-empty">
          <span>
            1200
            <br />
            ×
            <br />
            545
          </span>
        </div>
      )}
      <div class="banner-manage-info">
        <div style="display:flex;align-items:center;gap:.4rem">
          <div class="banner-manage-title">
            {slotLabel}
            {slot.title ? ` — ${slot.title}` : ''}
          </div>
          <span class={`banner-manage-status status-${statusClass}`}>{statusLabel}</span>
        </div>
        {slot.subtitle ? <div class="banner-manage-meta">{slot.subtitle}</div> : null}
        <div class="banner-manage-meta">
          {timeInfo}
          {remainText ? ` ・ ${remainText}` : ''}
          {!isEmpty ? ` ・ ${t('admin-banners.card.clicks', { n: slot.clicks })}` : ''}
        </div>
        <div style="display:flex;gap:.3rem;margin-top:.3rem">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              class={action === 'edit' ? 'primary-btn small' : 'outline-btn'}
              style={ACTION_STYLE[action]}
              data-banner-action={action}
              disabled={busy}
              onClick={() => onAction(action, slot)}
            >
              {action === 'edit'
                ? isEmpty
                  ? t('admin-banners.action.set')
                  : t('admin-banners.action.edit')
                : t(`admin-banners.action.${action}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
