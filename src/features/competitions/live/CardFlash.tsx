import type { JSX } from 'preact';
import { LIVE_COPY } from './copy';
import type { FlashCard } from './present';
import './live.css';

export interface CardFlashProps extends FlashCard {
  onClose: () => void;
}

/** 全螢幕亮牌。整面可點，底下那行字是「點一下關閉」。 */
export function CardFlash({ number, name, tone, secondYellow, onClose }: CardFlashProps): JSX.Element {
  const kind = secondYellow ? LIVE_COPY.secondYellow : tone === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;

  return (
    <div
      class={`s4-flash s4-flash--${tone}`}
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClose();
      }}
    >
      <div class="s4-flash__body">
        <div class="s4-flash__no">{number == null ? '—' : String(number)}</div>
        <div class="s4-flash__name">{name}</div>
        <div class="s4-flash__kind">{kind}</div>
      </div>
      <div class="s4-flash__close">{LIVE_COPY.tapToClose}</div>
    </div>
  );
}
