import type { JSX } from 'preact';
import type { RegBarModel } from '../../data/reg-capacity-bar';

/** 報名卡計量條（方案 C）。數字已由上方「N/M · 剩 · 團隊保留 · 候補」提供給讀屏，整塊 aria-hidden。 */
export function RegCapacityBar({ model }: { model: RegBarModel }): JSX.Element {
  return (
    <div class="evd-regbar" aria-hidden="true">
      <div class="evd-regbar-row">
        <div class="evd-regbar-track" style={`flex-basis:${model.mainBasis}%`}>
          {model.segments.map(seg => (
            <i key={seg.key} class={`evd-regbar-seg is-${seg.key}`} style={`width:${seg.pct}%`} />
          ))}
        </div>
        {model.waitlist > 0 && (
          <div class="evd-regbar-track is-wait" style={`flex-basis:${model.waitBasis}%`}>
            <i class="evd-regbar-seg is-wait" style="width:100%" />
          </div>
        )}
      </div>
      {model.legend.length > 0 && (
        <div class="evd-regbar-legend">
          {model.legend.map(item => (
            <span key={item.key} data-regbar-legend={item.key}>
              <i class={`evd-regbar-dot is-${item.key}`} />
              {`${item.label} ${item.count}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
