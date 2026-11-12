import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import type { EventDoc } from '../../data/types';

/**
 * 活動列表：同一天已結束／已取消的場次收成一行「已結束 N 場 ▸」，點開才畫卡片
 * （收合時不建立卡片 DOM、不載縮圖、不查留言數）。2026-11-13 站長選定，以日期群組為單位：
 * 列表只留結束 6 小時內的場次（R-EVT-002），已結束場次集中在今天與昨晚；未來日期已取消的場次留在原日期收合，
 * 日期欄、「今天」標記與月曆跳日錨點都不變。
 */
export function endedFoldKey(events: readonly EventDoc[]): 'ended' | 'cancelled' | 'mixed' {
  const cancelled = events.filter((e) => e.status === 'cancelled').length;
  if (cancelled === events.length) return 'cancelled';
  return cancelled > 0 ? 'mixed' : 'ended';
}

export function EndedFold<T extends EventDoc>(props: {
  events: readonly T[];
  renderCard: (event: T, index: number) => JSX.Element;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t(`events.listCard.fold.${endedFoldKey(props.events)}`, { count: props.events.length });
  return (
    <div class={open ? 'tl-ended-fold is-open' : 'tl-ended-fold'}>
      <button
        type="button"
        class="tl-ended-fold-btn"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span class="tl-ended-fold-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && props.events.map(props.renderCard)}
    </div>
  );
}
