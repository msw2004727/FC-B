import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { LiveScoreBadge } from '../live/LiveScoreBadge';
import { StatusTag } from './status-tag';

describe('StatusTag', () => {
  it('已取消帶紅字描邊的種類；其餘一律中性色調', () => {
    const view = render(
      <div>
        <StatusTag kind="cancelled" label="已取消" />
        <StatusTag kind="live" label="進行中" />
        <StatusTag kind="neutral" label="已核准" class="cps-li__tag" />
        <StatusTag kind="next" label="下一場" />
      </div>,
    );
    const [cancelled, live, neutral, next] = [...view.container.querySelectorAll('.ui-badge')];
    expect(cancelled?.className).toContain('ui-badge--danger');
    expect(cancelled?.className).toContain('d2-tag d2-tag--cancelled');
    expect(live?.className).toContain('ui-badge--neutral');
    expect(live?.className).toContain('d2-tag--live');
    expect(neutral?.className).toContain('d2-tag--neutral');
    expect(neutral?.className).toContain('cps-li__tag');
    expect(next?.className).toContain('d2-tag--next');
    for (const el of [cancelled, live, neutral, next]) expect(el?.className).toContain('ui-badge--sm');
  });

  it('「即時」是亮燈標籤、不再另畫紅點；「比分已更正」中性', () => {
    const view = render(
      <div>
        <LiveScoreBadge kind="live" />
        <LiveScoreBadge kind="corrected" />
      </div>,
    );
    expect(view.container.querySelector('.s4-dot')).toBeNull();
    const [live, corrected] = [...view.container.querySelectorAll('.s4-live > .ui-badge')];
    expect(live?.className).toContain('d2-tag--live');
    expect(live?.textContent).toBe('即時');
    expect(corrected?.className).toContain('d2-tag--neutral');
  });
});
