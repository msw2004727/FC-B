import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventDetailInfoSection, type LegacyDetailEvent } from './EventDetailMainView';

vi.mock('@/ui/UserTag', () => ({ UserTag: () => null }));

afterEach(() => {
  cleanup();
});

function detailEvent(overrides: Partial<LegacyDetailEvent> = {}): LegacyDetailEvent {
  return {
    id: 'public-1',
    title: '測試活動',
    date: '2099/01/01 10:00~12:00',
    status: 'open',
    location: '球場',
    current: 0,
    max: 10,
    ...overrides,
  } as LegacyDetailEvent;
}

function regOpenText(event: LegacyDetailEvent, nowMs: number): string | null {
  render(
    <EventDetailInfoSection
      event={event}
      confirmedCount={0}
      waitlistCount={0}
      nowMs={nowMs}
      roles={{}}
      onOpenProfile={vi.fn()}
      onContactHost={vi.fn()}
      onOpenTeam={vi.fn()}
    />,
  );
  return document.querySelector('[data-detail-field="registration-open"]')?.textContent ?? null;
}

describe('formatRegOpenInfo（開放報名列）', () => {
  const openAt = Date.parse('2026-10-19T09:00:00+08:00');

  it('即將開放剩 1 分鐘，regStr 逐字相同', () => {
    expect(regOpenText(
      detailEvent({ status: 'upcoming', regOpenTime: '2026-10-19T09:00' }),
      Date.parse('2026-10-19T08:59:00+08:00'),
    )).toBe('開放報名2026/10/19 09:00（1分後開放）');
  });

  it('已開放的字串逐字相同', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: '2026-10-19T09:00' }),
      openAt,
    )).toBe('開放報名2026/10/19 09:00（已開放）');
  });

  it('帶 Z 的絕對時間在每個時區都顯示台北 09:00', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: '2026-10-19T01:00:00Z' }),
      openAt,
    )).toBe('開放報名2026/10/19 09:00（已開放）');
  });

  it('台北 00:30 不會變成前一天', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: '2026-10-19T00:30' }),
      Date.parse('2026-10-19T01:00:00+08:00'),
    )).toBe('開放報名2026/10/19 00:30（已開放）');
  });

  it('無法解析的 regOpenTime 不顯示開放報名列', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: 'nope' }),
      openAt,
    )).toBeNull();
  });
});

describe('T-054c EV1 倒數（EV2 開放報名列沿用上方逐字案例）', () => {
  it.each([
    ['2026-10-18T09:00:00+08:00', '剩餘 1日2時'],
    ['2026-10-19T10:30:00+08:00', '剩餘 30分'],
    ['2026-10-19T11:00:00+08:00', '已結束'],
  ])('now=%s', (now, expected) => {
    regOpenText(detailEvent({ id: 'evtA', date: '2026/10/19 11:00~13:00' }), Date.parse(now));
    const value = document.querySelector('[data-detail-field="countdown"] > span:last-child');
    expect(value?.textContent).toBe(expected);
  });
});
