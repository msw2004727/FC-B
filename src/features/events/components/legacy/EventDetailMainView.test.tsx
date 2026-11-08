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
    )).toBe('2026/10/19 09:00（1分後開放）');
  });

  it('已開放的字串逐字相同', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: '2026-10-19T09:00' }),
      openAt,
    )).toBe('2026/10/19 09:00（已開放）');
  });

  it('帶 Z 的絕對時間在每個時區都顯示台北 09:00', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: '2026-10-19T01:00:00Z' }),
      openAt,
    )).toBe('2026/10/19 09:00（已開放）');
  });

  it('台北 00:30 不會變成前一天', () => {
    expect(regOpenText(
      detailEvent({ status: 'open', regOpenTime: '2026-10-19T00:30' }),
      Date.parse('2026-10-19T01:00:00+08:00'),
    )).toBe('2026/10/19 00:30（已開放）');
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
    ['2026-10-18T09:00:00+08:00', '距開始 1日2時'],
    ['2026-10-19T10:30:00+08:00', '距開始 30分'],
    ['2026-10-19T11:00:00+08:00', '已結束'],
  ])('now=%s', (now, expected) => {
    regOpenText(detailEvent({ id: 'evtA', date: '2026/10/19 11:00~13:00' }), Date.parse(now));
    const value = document.querySelector('[data-detail-field="countdown"]');
    expect(value?.textContent).toBe(expected);
  });
});

function renderInfo(event: LegacyDetailEvent, opts: { confirmed?: number; waitlist?: number; nowMs?: number } = {}): void {
  render(
    <EventDetailInfoSection
      event={event}
      confirmedCount={opts.confirmed ?? 0}
      waitlistCount={opts.waitlist ?? 0}
      nowMs={opts.nowMs ?? Date.parse('2026-10-01T09:00:00+08:00')}
      roles={{}}
      onOpenProfile={vi.fn()}
      onContactHost={vi.fn()}
      onOpenTeam={vi.fn()}
    />,
  );
}

describe('C2 票根＋分區小卡', () => {
  it('票根用台北時區顯示月／日／星期與時間、時長（台北凌晨不退回前一天）', () => {
    renderInfo(detailEvent({ date: '2026/11/09 00:30~02:00' }));
    expect(document.querySelector('.evd-ticket-mo')?.textContent).toBe('11 月');
    expect(document.querySelector('.evd-ticket-day')?.textContent).toBe('09');
    expect(document.querySelector('.evd-ticket-wd')?.textContent).toBe('週一');
    expect(document.querySelector('[data-detail-field="date"]')?.textContent).toBe('00:30–02:00');
    expect(document.querySelector('.evd-ticket-sub')?.textContent).toContain('1 小時 30 分');
  });

  it('無法解析的日期不顯示票根，時間列保留原字串', () => {
    renderInfo(detailEvent({ date: 'invalid' }));
    expect(document.querySelector('.evd-ticket-stub')).toBeNull();
    expect(document.querySelector('[data-detail-field="date"]')?.textContent).toBe('invalid');
  });

  // Gemini 審查 P2：只有日期沒有時間時，時間列不可留白。
  it('只有日期沒有時間時，票根照常顯示、時間列退回原字串', () => {
    renderInfo(detailEvent({ date: '2026/11/09' }));
    expect(document.querySelector('.evd-ticket-day')?.textContent).toBe('09');
    expect(document.querySelector('[data-detail-field="date"]')?.textContent).toBe('2026/11/09');
  });

  it('早鳥窗口內報名卡顯示早鳥積分標籤，窗口外不顯示', () => {
    const event = detailEvent({
      date: '2026/11/09 19:00~21:00',
      regOpenTime: '2026/10/05 12:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 20,
    } as Partial<LegacyDetailEvent>);
    renderInfo(event);
    expect(document.querySelector('[data-detail-field="early-bird"]')?.textContent).toBe('早鳥 20 積分');
    cleanup();
    renderInfo(event, { nowMs: Date.parse('2026-10-06T09:00:00+08:00') });
    expect(document.querySelector('[data-detail-field="early-bird"]')).toBeNull();
  });

  it('沒有任何參加條件時整張參加條件卡不出現', () => {
    renderInfo(detailEvent());
    expect(document.querySelector('[data-evd-card="conditions"]')).toBeNull();
    expect(document.body.textContent).not.toContain('參加條件');
  });

  it('有年齡與私密條件時參加條件卡只列出有的項目', () => {
    renderInfo(detailEvent({ minAge: 18, privateEvent: true }));
    const card = document.querySelector('[data-evd-card="conditions"]');
    expect(card?.querySelector('[data-detail-field="age-limit"]')?.textContent).toBe('18 歲以上');
    expect(card?.querySelector('[data-detail-field="private-visibility"]')).toBeTruthy();
    expect(card?.querySelector('[data-detail-field="gender-limit"]')).toBeNull();
    expect(card?.querySelector('[data-detail-field="team-limit"]')).toBeNull();
  });

  it('沒有團隊保留與候補時報名卡不出現對應文字', () => {
    renderInfo(detailEvent({ max: 24 }), { confirmed: 18 });
    const row = document.querySelector('[data-detail-field="capacity-count"]');
    expect(row?.textContent).toBe('已報 18/24剩 6');
    expect(row?.textContent).not.toContain('團隊保留');
    expect(row?.textContent).not.toContain('候補');
    expect(document.querySelector('.evd-progress-reserved')).toBeNull();
  });

  it('有團隊保留與候補時報名卡列出剩餘、團隊保留、候補', () => {
    renderInfo(detailEvent({
      max: 24,
      teamReservationSummaries: [{ teamId: 't1', remainingSlots: 4 }],
    } as Partial<LegacyDetailEvent>), { confirmed: 18, waitlist: 3 });
    expect(document.querySelector('[data-detail-field="capacity-count"]')?.textContent)
      .toBe('已報 18/24剩 2 · 團隊保留 4 · 候補 3');
    expect(document.querySelector('.evd-progress-reserved')).toBeTruthy();
  });
});

describe('C2 報名卡：團隊預留自動釋出', () => {
  const START = Date.parse('2026-11-20T20:00:00+08:00');
  const H = 3_600_000;
  const base = {
    max: 20,
    date: '2026/11/20 20:00~22:00',
    teamReservationSummaries: [{ teamId: 't1', remainingSlots: 4 }],
  };
  const meta = (): Element | null => document.querySelector('[data-detail-field="capacity-count"] .evd-reg-meta');

  it('倒數接在「團隊保留 M」後面，span 帶顏色 class；剩不到 1 小時改 warning class', () => {
    renderInfo(detailEvent({ ...base, teamReservationReleaseHours: 12 } as Partial<LegacyDetailEvent>), {
      confirmed: 12, waitlist: 2, nowMs: START - 18 * H,
    });
    expect(meta()?.textContent).toBe('剩 4 · 團隊保留 4 · 6 小時後釋出 · 候補 2');
    const span = meta()?.querySelector('.evd-reg-release');
    expect(span?.textContent).toBe('6 小時後釋出');
    expect(span?.classList.contains('is-soon')).toBe(false);
    cleanup();
    renderInfo(detailEvent({ ...base, teamReservationReleaseHours: 12 } as Partial<LegacyDetailEvent>), {
      confirmed: 12, nowMs: START - 12 * H - 30 * 60_000,
    });
    expect(meta()?.querySelector('.evd-reg-release.is-soon')?.textContent).toBe('30 分鐘後釋出');
  });

  it('已釋出且摘要非空：「團隊保留已釋出」不帶數字；摘要空則維持原文字', () => {
    renderInfo(detailEvent({
      max: 20,
      date: base.date,
      teamReservationReleaseHours: 12,
      teamReservationReleasedAt: { seconds: 1 },
      teamReservationReleasedSummary: [{ teamId: 't1', teamName: 'A', releasedSlots: 3 }],
    } as Partial<LegacyDetailEvent>), { confirmed: 18, waitlist: 1, nowMs: START - H });
    expect(meta()?.textContent).toBe('剩 2 · 團隊保留已釋出 · 候補 1');
    cleanup();
    renderInfo(detailEvent({
      max: 20,
      date: base.date,
      teamReservationReleaseHours: 12,
      teamReservationReleasedAt: { seconds: 1 },
      teamReservationReleasedSummary: [],
    } as Partial<LegacyDetailEvent>), { confirmed: 18, waitlist: 1, nowMs: START - H });
    expect(meta()?.textContent).toBe('剩 2 · 候補 1');
    expect(meta()?.textContent).not.toContain('釋出');
  });

  it('hours 為 0 或沒有欄位：與原本文字完全相同', () => {
    for (const extra of [{ teamReservationReleaseHours: 0 }, {}]) {
      renderInfo(detailEvent({ ...base, ...extra } as Partial<LegacyDetailEvent>), {
        confirmed: 12, waitlist: 2, nowMs: START - 18 * H,
      });
      expect(document.querySelector('[data-detail-field="capacity-count"]')?.textContent)
        .toBe('已報 12/20剩 4 · 團隊保留 4 · 候補 2');
      expect(document.querySelector('.evd-reg-release')).toBeNull();
      cleanup();
    }
  });
});
