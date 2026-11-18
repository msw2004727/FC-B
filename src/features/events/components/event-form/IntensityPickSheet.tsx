import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { VISIBLE_ACTIVITY_CATEGORIES, type IntensityChoice } from '../../data/activity-categories';
import { IntensityIcon } from './IntensityIcon';
import './create-event-type-sheet.css';

export interface IntensityPickSheetProps {
  open: boolean;
  onClose(): void;
  onPick(level: IntensityChoice): void;
}

/** 「自訂活動」之後的分類三選一；外觀同選擇活動類型（底部液態玻璃）。 */
export function IntensityPickSheet({ open, onClose, onPick }: IntensityPickSheetProps): JSX.Element | null {
  const lt = useLegacyT();
  const current = useRef({ onClose, onPick });
  current.current = { onClose, onPick };

  useLayoutEffect(() => {
    if (!open) return;
    return pushOverlay(() => {
      current.current.onClose();
      return true;
    });
  }, [open]);

  if (!open) return null;

  const options: { key: IntensityChoice; label: string }[] = [
    { key: '', label: '一般' },
    ...VISIBLE_ACTIVITY_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
  ];

  return createPortal(
    <div class="legacy-ui">
      <div
        id="create-event-intensity-sheet"
        class="cets-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cets-intensity-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) current.current.onClose();
        }}
      >
        <div class="cets-panel">
          <div class="cets-grab" />
          <div class="cets-title" id="cets-intensity-title">{lt('選擇活動分類', '選擇活動分類')}</div>
          {options.map((opt, idx) => (
            <button
              key={opt.key || 'normal'}
              type="button"
              class={`cets-option cets-tone-${opt.key || 'normal'}`}
              data-intensity={opt.key || 'normal'}
              style={{ animationDelay: `${0.08 + idx * 0.06}s` }}
              onClick={() => {
                const latest = current.current;
                latest.onClose();
                latest.onPick(opt.key);
              }}
            >
              <span class="cets-ico"><IntensityIcon level={opt.key} /></span>
              <span class="cets-tx"><b>{lt(opt.label, opt.label)}</b></span>
              <svg class="cets-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))}
          <button type="button" class="cets-cancel" onClick={() => current.current.onClose()}>
            {lt('取消', '取消')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
