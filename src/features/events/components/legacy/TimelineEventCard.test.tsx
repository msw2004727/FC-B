import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelineEventCard, type LegacyEventDoc } from './TimelineEventCard';

function event(overrides: Record<string, unknown> = {}): LegacyEventDoc {
  return {
    id: 'ev-1',
    title: '練球',
    status: 'open',
    date: '2030/10/19 18:00~20:00',
    location: '台北市大安運動中心',
    type: 'play',
    sportTag: 'football',
    max: 10,
    current: 0,
    ...overrides,
  } as LegacyEventDoc;
}

function rowNames(ev: LegacyEventDoc): string[] {
  const { container, unmount } = render(
    <TimelineEventCard
      event={ev}
      viewerUid={null}
      viewerRoleLevel={0}
      viewerRegistrations={[]}
      isPending={false}
      isFavorited={false}
      onSelect={() => undefined}
      onToggleFavorite={() => undefined}
    />,
  );
  const names = (container.querySelector('.tl-event-row')?.className ?? '').split(/\s+/).filter(Boolean);
  unmount();
  return names;
}

afterEach(() => {
  cleanup();
});

describe('TimelineEventCard 活動分類', () => {
  it('beginner → tl-type-beginner、high-intensity → tl-type-high-intensity', () => {
    const beginner = rowNames(event({ intensityLevel: 'beginner' }));
    expect(beginner).toContain('tl-type-play');
    expect(beginner).toContain('tl-type-beginner');
    expect(beginner).not.toContain('tl-type-high-intensity');

    const high = rowNames(event({ intensityLevel: 'high-intensity' }));
    expect(high).toContain('tl-type-high-intensity');
    expect(high).not.toContain('tl-type-beginner');
  });

  it('女生專屬加上分類只留 tl-type-female-only', () => {
    const names = rowNames(event({
      intensityLevel: 'high-intensity',
      genderRestrictionEnabled: true,
      allowedGender: '女',
    }));
    expect(names).toContain('tl-type-female-only');
    expect(names).not.toContain('tl-type-beginner');
    expect(names).not.toContain('tl-type-high-intensity');
  });

  it('外部活動不加分類 class', () => {
    const names = rowNames(event({
      type: 'external',
      intensityLevel: 'beginner',
      genderRestrictionEnabled: true,
      allowedGender: '女',
    }));
    expect(names).toContain('tl-type-external');
    expect(names).not.toContain('tl-type-beginner');
    expect(names).not.toContain('tl-type-high-intensity');
    expect(names).not.toContain('tl-type-female-only');
  });
});
