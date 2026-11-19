import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { LIVE_COPY } from './copy';
import type { FlashCard } from './present';
import './live.css';

export interface CardFlashProps extends FlashCard {
  onClose: () => void;
}

/** 全螢幕亮牌。對話框語意，Esc 或點一下關閉，焦點回到打開它的按鈕。 */
export function CardFlash({ number, name, tone, secondYellow, onClose }: CardFlashProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const kind = secondYellow ? LIVE_COPY.secondYellow : tone === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;
  const who = number == null ? name : `${number} ${name}`;
  const label = `${kind} ${who}`.trim();

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      class={`s4-flash s4-flash--${tone}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
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
