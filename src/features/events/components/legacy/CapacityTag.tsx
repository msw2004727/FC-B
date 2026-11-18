import type { JSX } from 'preact';
import type { CapacityTagModel, CapacityTagPayment } from '../../data/capacity-tag';
import './signup-a11y.css'; // 讀屏人數用 .fcb-sr-only
import './capacity-tag.css';

export interface CapacityTagProps {
  model: CapacityTagModel;
  /** 讀屏文字；沒給時整個標籤 aria-hidden（活動頁計量條已有讀屏人數）。 */
  srText?: string;
  /** 付款狀態外觀預留接點（目前無呼叫端傳入，見 capacity-tag.ts）。 */
  payment?: CapacityTagPayment;
  class?: string;
}

/** 人數標籤「XX/XX」：狀態變色玻璃膠囊（站長 11-13 定案風格三）。 */
export function CapacityTag({ model, srText, payment, class: extra }: CapacityTagProps): JSX.Element {
  const cls = [
    'tl-cap-tag',
    `is-${model.state}`,
    model.long ? 'is-long' : '',
    payment ? `has-pay is-pay-${payment}` : '',
    extra || '',
  ].filter(Boolean).join(' ');
  return (
    <span class={cls} aria-hidden={srText ? undefined : 'true'}>
      <svg class="tl-cap-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="7.5" r="3.6" />
        <path d="M4.8 20.2c.6-4 3.5-6.4 7.2-6.4s6.6 2.4 7.2 6.4" />
      </svg>
      <span class="tl-cap-n" aria-hidden="true">{model.confirmed}</span>
      {model.max > 0 && <span class="tl-cap-max" aria-hidden="true">/{model.max}</span>}
      {payment && <span class="tl-cap-pay" aria-hidden="true" />}
      {srText && <span class="fcb-sr-only">{srText}</span>}
    </span>
  );
}
