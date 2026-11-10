import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { AttendanceRosterTable } from './AttendanceRosterTable';
import { WaitlistRosterTable } from './WaitlistRosterTable';
import { snapshot } from '../data/roster-status-test-fixtures';

vi.mock('@/i18n/i18n', async (importOriginal) => {
  const dict: Record<string, string> = {
    'ui.userTag.role.user': '一般用戶',
    'ui.userTag.role.coach': '教練',
    'ui.userTag.openProfile': '檢視 {name}',
    'ui.userTag.unknown': '未知用戶',
    'events.roster.proxyBadge': '代報',
    'events.roster.promoteColumn': '正取',
    'events.roster.promoteButton': '正取',
    'events.roster.promotePending': '...',
    'events.roster.promoteAria': '將 {name} 正取',
  };
  return {
    ...(await importOriginal<typeof import('@/i18n/i18n')>()),
    useT: () => (key: string, params?: Record<string, unknown>) => {
      let tmpl = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          tmpl = tmpl.replace(`{${k}}`, String(v));
        }
      }
      return tmpl;
    },
  };
});

afterEach(() => {
  cleanup();
});

describe('AttendanceRosterTable', () => {
  it('renders empty state when there are no confirmed participants', () => {
    render(
      <AttendanceRosterTable
        event={{ id: 'e1', max: 12 }}
        registrations={[]}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );
    expect(screen.getByText('尚無報名')).toBeTruthy();
  });

  it('renders header count, UserTag, companion row, proxyOnly row, placeholder row, and checkin/checkout/note', () => {
    const onOpenProfile = vi.fn();
    const { container } = render(
      <AttendanceRosterTable
        event={{
          id: 'e1',
          max: 10,
          teamReservationSummaries: [
            {
              teamId: 't1',
              teamName: 'FC One',
              reservedSlots: 2,
              usedSlots: 1,
              remainingSlots: 1,
            },
          ],
        }}
        registrations={[
          {
            _docId: 'r1',
            userId: 'u1',
            userName: 'Alice',
            status: 'confirmed',
            participantType: 'self',
            teamReservationTeamId: 't1',
            teamReservationTeamName: 'FC One',
            registeredAt: '2026-05-01T10:00:00Z',
          },
          {
            _docId: 'r2',
            userId: 'u1',
            userName: 'Alice',
            companionId: 'c1',
            companionName: 'Alice Kid',
            status: 'confirmed',
            participantType: 'companion',
            teamReservationTeamId: 't1',
            teamReservationTeamName: 'FC One',
            registeredAt: '2026-05-01T10:01:00Z',
          },
          {
            _docId: 'r3',
            userId: 'u2',
            userName: 'ProxyParent',
            companionId: 'c2',
            companionName: 'ProxyKid',
            status: 'confirmed',
            participantType: 'companion',
            registeredAt: '2026-05-01T10:02:00Z',
          },
        ]}
        attendanceRecords={[
          {
            _docId: 'a1',
            uid: 'u1',
            userName: 'Alice',
            type: 'checkin',
            status: 'active',
            time: '2026/05/01 10:05',
          },
          {
            _docId: 'a2',
            uid: 'u1',
            userName: 'Alice',
            type: 'note',
            note: '遲到5分',
            status: 'active',
            time: '2026/05/01 10:06',
          },
        ]}
        roles={{ u1: 'coach' }}
        onOpenProfile={onOpenProfile}
      />,
    );

    // Count = Alice + Alice Kid + ProxyKid = 3 (excludes team header, placeholder, separator, and proxyOnly row)
    expect(screen.getByText('報名名單（3/10）')).toBeTruthy();
    expect(screen.getByText('簽到')).toBeTruthy();
    expect(screen.getByText('簽退')).toBeTruthy();
    expect(screen.getByText('備註')).toBeTruthy();
    expect(screen.getByText('FC One')).toBeTruthy();
    // 測試同步更新（站長 11-06 選「座位點」）：保留席位列改為「保留」膠囊，隊名放在 title 與讀屏文字。
    const seatPill = screen.getByTitle('FC One 保留席位');
    expect(seatPill.textContent).toBe('保留：FC One');
    expect(seatPill.classList.contains('team-reservation-seat-pill')).toBe(true);
    // 保留列的簽到／簽退／備註留白（不再寫「--」或「保留席位」）。
    const seatCells = Array.from(seatPill.closest('tr')!.cells);
    expect(seatCells.slice(-3).map(td => td.textContent)).toEqual(['', '', '']);
    expect(screen.getByText('一般報名')).toBeTruthy();
    expect(screen.getByText('ProxyParent')).toBeTruthy();
    expect(screen.getByText('僅代報')).toBeTruthy();
    // 測試同步更新：同行者改 B2 呈現
    expect(container.textContent).not.toContain('↳');
    expect(screen.getByText('Alice Kid')).toBeTruthy();
    expect(screen.getByText('ProxyKid')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect([...container.querySelectorAll('.cr-owner')].map((node) => node.textContent)).toEqual(['A', 'P']);
    expect(container.querySelector('.cr-ghost')?.textContent).toBe('ProxyParent');
    expect(container.querySelector('.cr-proxy-badge')?.textContent).toContain('代報');
    expect(seatPill.closest('td')?.querySelector('.cr-lead, .cr-pair, .cr-ghost, .cr-link')).toBeNull();
    for (const link of container.querySelectorAll('.cr-link')) {
      expect(link.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('遲到5分')).toBeTruthy();

    const userTagBtn = screen.getByRole('button', { name: /Alice/ });
    fireEvent.click(userTagBtn);
    expect(onOpenProfile).toHaveBeenCalledWith('u1');
    expect(userTagBtn.closest('.cr-lead')).toBeTruthy();
  });

  it('B2：lead +2、代報虛線、solo 名字欄 DOM 不變、同行者不可點', () => {
    const { container } = render(
      <AttendanceRosterTable
        event={{ id: 'e-b2', max: 10 }}
        registrations={[
          {
            _docId: 'solo', userId: 'solo', userName: 'Solo', status: 'confirmed',
            participantType: 'self', registeredAt: '2026-05-01T09:00:00Z',
          },
          {
            _docId: 'a', userId: 'alice', userName: 'Alice', status: 'confirmed',
            participantType: 'self', registeredAt: '2026-05-01T10:00:00Z',
          },
          {
            _docId: 'c1', userId: 'alice', userName: 'Alice', companionId: 'k1', companionName: 'Kid One',
            status: 'confirmed', participantType: 'companion', registeredAt: '2026-05-01T10:01:00Z',
          },
          {
            _docId: 'c2', userId: 'alice', userName: 'Alice', companionId: 'k2', companionName: 'Kid Two',
            status: 'confirmed', participantType: 'companion', registeredAt: '2026-05-01T10:02:00Z',
          },
          {
            _docId: 'p', userId: 'proxy', userName: '王志明', companionId: 'pk', companionName: '王小寶',
            status: 'confirmed', participantType: 'companion', registeredAt: '2026-05-01T11:00:00Z',
          },
        ]}
        attendanceRecords={[]}
        roles={{ solo: 'user', alice: 'coach' }}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.textContent).not.toContain('↳');
    expect(screen.getByText('+2')).toBeTruthy();
    expect([...container.querySelectorAll('.cr-owner')].map((node) => node.textContent)).toEqual(['A', 'A', '志']);
    expect(container.querySelector('.cr-ghost')?.textContent).toBe('王志明');
    expect(container.querySelector('.cr-proxy-badge')?.textContent).toContain('代報');
    expect(screen.queryByRole('button', { name: /Kid One/ })).toBeNull();

    const soloTd = screen.getByRole('button', { name: /Solo/ }).closest('td');
    expect(soloTd?.className ?? '').toBe('');
    expect(soloTd?.querySelector('.reg-name-text .user-capsule')).toBeTruthy();
    expect(soloTd?.querySelector('.cr-lead, .cr-pair, .cr-ghost, .cr-link, .cr-plus')).toBeNull();

    const aliceRow = screen.getByText('+2').closest('tr');
    expect(aliceRow?.querySelector('.cr-link-down')).toBeTruthy();
    expect(aliceRow?.querySelector('.cr-link-dashed')).toBeNull();
    expect(screen.getByText('Kid One').closest('td')?.querySelector('.cr-v-bot')).toBeTruthy();
    expect(screen.getByText('Kid Two').closest('td')?.querySelector('.cr-v-bot')).toBeNull();
    expect(screen.getByText('Kid Two').closest('td')?.querySelector('.cr-link')).toBeTruthy();

    const proxyRow = screen.getByText('王志明').closest('tr');
    expect(proxyRow?.querySelector('.cr-link')?.classList.contains('cr-link-dashed')).toBe(true);
    expect(screen.getByText('王小寶').closest('td')?.querySelector('.cr-corner path')?.getAttribute('stroke-dasharray')).toBe('6 5');
    for (const link of container.querySelectorAll('.cr-link')) {
      expect(link.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('hides checkin/checkout/note columns when publicRosterOnly is true', () => {
    render(
      <AttendanceRosterTable
        event={{ id: 'e1', max: 10 }}
        registrations={[
          {
            _docId: 'r1',
            userId: 'u1',
            userName: 'Alice',
            status: 'confirmed',
            participantType: 'self',
          },
        ]}
        attendanceRecords={[
          {
            _docId: 'a1',
            uid: 'u1',
            userName: 'Alice',
            type: 'checkin',
            status: 'active',
          },
        ]}
        roles={{ u1: 'user' }}
        onOpenProfile={vi.fn()}
        publicRosterOnly={true}
      />,
    );

    expect(screen.getByText('報名名單（1/10）')).toBeTruthy();
    expect(screen.queryByText('簽到')).toBeNull();
    expect(screen.queryByText('簽退')).toBeNull();
    expect(screen.queryByText('備註')).toBeNull();
    expect(screen.queryByText('✓')).toBeNull();
  });

  it('shows 踢 column only in editing mode when canRemoveConfirmed is true, and never renders 候 column', () => {
    const onKick = vi.fn();
    const regs = [
      {
        _docId: 'r1',
        userId: 'u1',
        userName: 'Alice',
        status: 'confirmed',
        participantType: 'self',
      },
      {
        _docId: 'r2',
        userId: 'u2',
        userName: 'ProxyParent',
        companionId: 'c2',
        companionName: 'ProxyKid',
        status: 'confirmed',
        participantType: 'companion',
      },
    ];

    const { rerender } = render(
      <AttendanceRosterTable
        event={{ id: 'e1', max: 10 }}
        registrations={regs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
        canManage={true}
        canRemoveConfirmed={true}
        editing={false}
        onKickParticipant={onKick}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: '踢' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '候' })).toBeNull();

    rerender(
      <AttendanceRosterTable
        event={{ id: 'e1', max: 10 }}
        registrations={regs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
        canManage={true}
        canRemoveConfirmed={false}
        editing={true}
        onKickParticipant={onKick}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: '踢' })).toBeNull();

    rerender(
      <AttendanceRosterTable
        event={{ id: 'e1', max: 10 }}
        registrations={regs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
        canManage={true}
        canRemoveConfirmed={true}
        editing={true}
        onKickParticipant={onKick}
      />,
    );
    expect(screen.getByRole('columnheader', { name: '踢' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: '候' })).toBeNull();

    // Alice and ProxyKid have kick buttons; ProxyParent (proxyOnly) has empty kick cell
    const kickButtons = screen.getAllByRole('button', { name: '踢' });
    expect(kickButtons.length).toBe(2);
    fireEvent.click(kickButtons[0]!);
    expect(onKick).toHaveBeenCalledTimes(1);
    expect(onKick.mock.calls[0]?.[0]?.uid).toBe('u1');
  });
});

describe('名單定案版面', () => {
  const layoutRegs = [
    {
      _docId: 's1', userId: 'n1', userName: 'Neil', status: 'confirmed',
      participantType: 'self', registeredAt: '2026-05-01T09:00:00Z',
    },
    {
      _docId: 's2', userId: 'n2', userName: '小孫', status: 'confirmed',
      participantType: 'self', registeredAt: '2026-05-01T09:01:00Z',
    },
    {
      _docId: 'a', userId: 'alice', userName: 'Alice', status: 'confirmed',
      participantType: 'self', registeredAt: '2026-05-01T10:00:00Z',
    },
    {
      _docId: 'k1', userId: 'alice', userName: 'Alice', companionId: 'k1', companionName: 'Kid One',
      status: 'confirmed', participantType: 'companion', registeredAt: '2026-05-01T10:01:00Z',
    },
    {
      _docId: 'k2', userId: 'alice', userName: 'Alice', companionId: 'k2', companionName: 'Kid Two',
      status: 'confirmed', participantType: 'companion', registeredAt: '2026-05-01T10:02:00Z',
    },
    {
      _docId: 's3', userId: 'n3', userName: '培亮', status: 'confirmed',
      participantType: 'self', registeredAt: '2026-05-01T10:30:00Z',
    },
    {
      _docId: 'p', userId: 'proxy', userName: '王志明', companionId: 'pk', companionName: '王小寶',
      status: 'confirmed', participantType: 'companion', registeredAt: '2026-05-01T11:00:00Z',
    },
  ];

  function rowOf(name: string): HTMLTableRowElement {
    return screen.getByText(name).closest('tr')!;
  }

  it('一般檢視有序號，代報人沒有、同行者有；管理模式沒有序號，也不多一欄', () => {
    const view = render(
      <AttendanceRosterTable
        event={{ id: 'e-final', max: 30 }}
        registrations={layoutRegs}
        attendanceRecords={[]}
        roles={{ n2: 'coach', alice: 'coach' }}
        onOpenProfile={vi.fn()}
        canManage
        canRemoveConfirmed
      />,
    );

    expect(rowOf('Neil').querySelector('.att-no')?.textContent).toBe('1');
    expect(rowOf('小孫').querySelector('.att-no')?.textContent).toBe('2');
    expect(rowOf('Alice').querySelector('.att-no')?.textContent).toBe('3');
    expect(rowOf('Kid One').querySelector('.att-no')?.textContent).toBe('4');
    expect(rowOf('Kid Two').querySelector('.att-no')?.textContent).toBe('5');
    expect(rowOf('培亮').querySelector('.att-no')?.textContent).toBe('6');
    expect(rowOf('王志明').querySelector('.att-no')?.textContent).toBe('');
    expect(rowOf('王小寶').querySelector('.att-no')?.textContent).toBe('7');

    const viewColumns = document.querySelectorAll('thead th').length;
    expect(viewColumns).toBe(4);
    for (const tr of document.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      expect(Array.from(tr.cells).reduce((sum, cell) => sum + cell.colSpan, 0)).toBe(viewColumns);
    }

    view.rerender(
      <AttendanceRosterTable
        event={{ id: 'e-final', max: 30 }}
        registrations={layoutRegs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
        canManage
        canRemoveConfirmed
        editing
      />,
    );
    expect(document.querySelector('.att-no')).toBeNull();
    expect(document.querySelector('table')?.classList.contains('att-roster-managing')).toBe(true);
    const editColumns = document.querySelectorAll('thead th').length;
    expect(editColumns).toBe(5);
    expect(screen.getByRole('columnheader', { name: '踢' }).style.width).toBe('2rem');
    expect(screen.getByRole('columnheader', { name: '簽到' }).style.width).toBe('2.5rem');
    expect(screen.getByRole('columnheader', { name: '簽退' }).style.width).toBe('2.5rem');
    expect(screen.getByRole('columnheader', { name: '備註' }).style.width).toBe('4.5rem');
    for (const tr of document.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      expect(Array.from(tr.cells).reduce((sum, cell) => sum + cell.colSpan, 0)).toBe(editColumns);
    }
  });

  it('同行者名牌有斜方塊 class，主報名人與代報人沒有', () => {
    render(
      <AttendanceRosterTable
        event={{ id: 'e-final', max: 30 }}
        registrations={layoutRegs}
        attendanceRecords={[]}
        roles={{ alice: 'coach' }}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(screen.getByText('Kid One').closest('.cr-cap')?.classList.contains('att-skew')).toBe(true);
    expect(screen.getByText('Kid Two').closest('.cr-cap')?.classList.contains('att-skew')).toBe(true);
    expect(screen.getByText('王小寶').closest('.cr-cap')?.classList.contains('att-skew')).toBe(true);
    expect(rowOf('Kid One').querySelector('.cr-owner')?.classList.contains('att-skew')).toBe(true);

    const lead = screen.getByRole('button', { name: /Alice/ });
    expect(lead.classList.contains('att-skew')).toBe(false);
    expect(lead.closest('.att-skew')).toBeNull();
    const ghost = screen.getByText('王志明');
    expect(ghost.classList.contains('att-skew')).toBe(false);
    expect(ghost.closest('.cr-ghost')?.classList.contains('att-skew')).toBe(false);
    expect(ghost.closest('.att-skew')).toBeNull();
  });

  it('單獨列有斑馬奇偶 class，組列沒有；組首尾列有分隔線 class', () => {
    render(
      <AttendanceRosterTable
        event={{ id: 'e-final', max: 30 }}
        registrations={layoutRegs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(rowOf('Neil').classList.contains('att-zebra-odd')).toBe(true);
    expect(rowOf('小孫').classList.contains('att-zebra-even')).toBe(true);
    expect(rowOf('培亮').classList.contains('att-zebra-odd')).toBe(true);

    for (const name of ['Alice', 'Kid One', 'Kid Two', '王志明', '王小寶']) {
      const row = rowOf(name);
      expect(row.classList.contains('att-zebra-odd')).toBe(false);
      expect(row.classList.contains('att-zebra-even')).toBe(false);
      expect(row.classList.contains('att-grp')).toBe(true);
    }
    expect(rowOf('Alice').classList.contains('att-grp-first')).toBe(true);
    expect(rowOf('Alice').classList.contains('att-grp-last')).toBe(false);
    expect(rowOf('Kid One').classList.contains('att-grp-first')).toBe(false);
    expect(rowOf('Kid One').classList.contains('att-grp-last')).toBe(false);
    expect(rowOf('Kid Two').classList.contains('att-grp-first')).toBe(false);
    expect(rowOf('Kid Two').classList.contains('att-grp-last')).toBe(true);
    expect(rowOf('王志明').classList.contains('att-grp-first')).toBe(true);
    expect(rowOf('王志明').classList.contains('att-grp-last')).toBe(false);
    expect(rowOf('王小寶').classList.contains('att-grp-last')).toBe(true);
    expect(rowOf('王志明').getAttribute('style')).toBeNull();
  });

  it('保留席位不佔序號，下一個算名額的人接著編', () => {
    render(
      <AttendanceRosterTable
        event={{
          id: 'e-seat',
          max: 10,
          teamReservationSummaries: [
            { teamId: 't1', teamName: 'FC One', reservedSlots: 2, usedSlots: 1, remainingSlots: 1 },
          ],
        }}
        registrations={[
          {
            _docId: 'a', userId: 'alice', userName: 'Alice', status: 'confirmed',
            participantType: 'self', teamReservationTeamId: 't1', teamReservationTeamName: 'FC One',
            registeredAt: '2026-05-01T10:00:00Z',
          },
          {
            _docId: 'b', userId: 'bob', userName: 'Bob', status: 'confirmed',
            participantType: 'self', registeredAt: '2026-05-01T11:00:00Z',
          },
        ]}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(screen.getByText('報名名單（2/10）')).toBeTruthy();
    expect(rowOf('Alice').querySelector('.att-no')?.textContent).toBe('1');
    const seat = screen.getByTitle('FC One 保留席位').closest('tr')!;
    expect(seat.querySelector('.att-no')?.textContent).toBe('');
    expect(seat.classList.contains('att-zebra-odd')).toBe(false);
    expect(seat.classList.contains('att-zebra-even')).toBe(false);
    expect(rowOf('Bob').querySelector('.att-no')?.textContent).toBe('2');
  });
});

describe('WaitlistRosterTable', () => {
  it('returns null when there are no waitlisted registrations', () => {
    const { container } = render(
      <WaitlistRosterTable
        event={{ id: 'e1' }}
        registrations={[
          { _docId: 'r1', userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self' },
        ]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders waitlist table with positions, companions, and orphan info when self is confirmed', () => {
    const onOpenProfile = vi.fn();
    render(
      <WaitlistRosterTable
        event={{ id: 'e1' }}
        registrations={[
          {
            _docId: 'r1',
            userId: 'u1',
            userName: 'Alice',
            status: 'confirmed',
            participantType: 'self',
            registeredAt: '2026-05-01T09:00:00Z',
          },
          {
            _docId: 'r2',
            userId: 'u1',
            userName: 'Alice',
            companionId: 'c1',
            companionName: 'Alice Jr',
            status: 'waitlisted',
            participantType: 'companion',
            registeredAt: '2026-05-01T10:00:00Z',
          },
        ]}
        roles={{ u1: 'user' }}
        onOpenProfile={onOpenProfile}
      />,
    );

    expect(screen.getByText('候補名單（2）')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: '#' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '姓名' })).toBeNull();
    const table = document.querySelector('table');
    expect(table?.classList.contains('att-roster')).toBe(true);
    expect(table?.classList.contains('att-roster-waitlist')).toBe(true);
    // 每個人一號：Alice 本人（已正取、仍排在候補組內）1、同行者 Alice Jr 2。
    expect([...document.querySelectorAll('.att-no')].map((el) => el.textContent)).toEqual(['1', '2']);
    // 本人已正取的報名人只是組頭，「下一位遞補」落在真正排隊的 Alice Jr。
    const aliceDots = [...document.querySelectorAll('.att-no')];
    expect(aliceDots[0]?.classList.contains('att-wl-next')).toBe(false);
    expect(aliceDots[1]?.classList.contains('att-wl-next')).toBe(true);
    for (const row of document.querySelectorAll('tbody tr')) {
      expect(row.classList.contains('att-grp')).toBe(true);
    }
    expect(screen.getByText('Alice Jr').closest('.cr-cap')).toBeTruthy();
    // 報名人本人已在正取名單：只在報名人名字右上角掛一個「已正取」小標籤，不再有「↳ 報名人」註記列。
    const confirmedTags = document.querySelectorAll('.att-wl-confirmed');
    expect(confirmedTags).toHaveLength(1);
    expect(confirmedTags[0]?.textContent).toBe('已正取');
    expect(confirmedTags[0]?.closest('.cr-lead')?.textContent).toContain('Alice');
    expect(screen.queryByText(/↳ 報名人/)).toBeNull();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    const hourglass = document.querySelector('.att-wl-title svg');
    expect(hourglass?.getAttribute('aria-hidden')).toBe('true');
    expect(hourglass?.getAttribute('width')).toBe('16');
  });

  it('順位每人一號（同行者也算），同行組照正取名單的連線畫法，排隊連線貫穿', () => {
    render(
      <WaitlistRosterTable
        event={{ id: 'e1' }}
        registrations={[
          {
            _docId: 'a',
            userId: 'ua',
            userName: 'Bob',
            status: 'waitlisted',
            participantType: 'self',
            registeredAt: '2026-05-01T09:00:00Z',
          },
          {
            _docId: 'ac',
            userId: 'ua',
            userName: 'Bob',
            companionId: 'k1',
            companionName: 'Kid',
            status: 'waitlisted',
            participantType: 'companion',
            registeredAt: '2026-05-01T09:01:00Z',
          },
          {
            _docId: 'b-self',
            userId: 'ub',
            userName: 'Cara',
            status: 'confirmed',
            participantType: 'self',
            registeredAt: '2026-05-01T08:00:00Z',
          },
          {
            _docId: 'b',
            userId: 'ub',
            userName: 'Cara',
            companionId: 'k2',
            companionName: 'Cara Jr',
            status: 'waitlisted',
            participantType: 'companion',
            registeredAt: '2026-05-02T09:00:00Z',
          },
        ]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );

    const dots = [...document.querySelectorAll('.att-no')];
    expect(dots.map((dot) => dot.textContent)).toEqual(['1', '2', '3', '4']);
    expect(dots[0]?.classList.contains('att-wl-next')).toBe(true);
    expect(dots.slice(1).some((dot) => dot.classList.contains('att-wl-next'))).toBe(false);

    // 同行組：報名人「+N」、同行者斜方塊加組色連線，列不吃斑馬、組有上下細線（與正取名單同一套 class）。
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.classList.contains('att-grp'))).toBe(true);
    expect(rows.some((row) => row.classList.contains('att-zebra-odd') || row.classList.contains('att-zebra-even'))).toBe(false);
    expect(rows[0]?.classList.contains('att-grp-first')).toBe(true);
    expect(rows[1]?.classList.contains('att-grp-last')).toBe(true);
    expect(rows[2]?.classList.contains('att-grp-first')).toBe(true);
    expect(rows[3]?.classList.contains('att-grp-last')).toBe(true);
    expect([...document.querySelectorAll('.cr-plus')].map((el) => el.textContent)).toEqual(['+1', '+1']);
    expect(document.querySelectorAll('.cr-link-down')).toHaveLength(2);
    expect(document.querySelectorAll('.cr-link-mate')).toHaveLength(2);
    expect(document.querySelectorAll('.cr-pair .cr-owner')).toHaveLength(2);
    // 兩組組色不同（slot 0、1）。
    const groupVars = [...document.querySelectorAll('td.cr-name-cell')].map((td) => (td as HTMLElement).style.getPropertyValue('--cr-g'));
    expect(new Set(groupVars).size).toBe(2);
    // 只有 Cara 本人已正取：她的名字右上角一個「已正取」小標籤，沒有註記列。
    expect(document.querySelectorAll('.att-wl-confirmed')).toHaveLength(1);
    expect(document.querySelector('.att-wl-confirmed')?.closest('tr')?.textContent).toContain('Cara');
    expect(document.querySelector('.att-wl-pass')).toBeNull();

    const linked = rows;
    expect(linked[0]?.querySelector('.att-wl-link-first')).toBeTruthy();
    expect(linked[linked.length - 1]?.querySelector('.att-wl-link-last')).toBeTruthy();
    expect(linked.every((row) => row.querySelector('.att-wl-link'))).toBe(true);
    expect(screen.getByText('候補名單（4）')).toBeTruthy();
  });

  it('單獨報名的候補才吃斑馬紋，且只在單獨列之間交替', () => {
    render(
      <WaitlistRosterTable
        event={{ id: 'e1' }}
        registrations={[
          { _docId: 'a', userId: 'ua', userName: 'A', status: 'waitlisted', participantType: 'self', registeredAt: '2026-05-01T01:00:00Z' },
          {
            _docId: 'bc', userId: 'ub', userName: 'B', companionId: 'k', companionName: 'Kid', status: 'waitlisted', participantType: 'companion', registeredAt: '2026-05-01T02:00:00Z',
          },
          { _docId: 'b', userId: 'ub', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-05-01T02:00:00Z' },
          { _docId: 'c', userId: 'uc', userName: 'C', status: 'waitlisted', participantType: 'self', registeredAt: '2026-05-01T03:00:00Z' },
        ]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );
    const rows = [...document.querySelectorAll('tbody tr')];
    const byText = (t: string) => rows.find((row) => row.textContent?.includes(t));
    expect(byText('A')?.classList.contains('att-zebra-odd')).toBe(true);
    expect(byText('C')?.classList.contains('att-zebra-even')).toBe(true);
    expect(byText('Kid')?.classList.contains('att-grp')).toBe(true);
  });

  it('只有一位時不畫連線', () => {
    render(
      <WaitlistRosterTable
        event={{ id: 'e1' }}
        registrations={[
          { _docId: 's', userId: 'us', userName: 'Solo', status: 'waitlisted', participantType: 'self' },
        ]}
        roles={{}}
        onOpenProfile={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('.att-no')).toHaveLength(1);
    expect(document.querySelector('.att-wl-next')?.textContent).toBe('1');
    expect(document.querySelector('.att-wl-link')).toBeNull();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('編輯模式遞補欄在最左，連線留在姓名欄，點擊仍送出該候補', () => {
    const state = snapshot('promote');
    const base = state.registrations[0];
    if (!base) throw new Error('missing fixture');
    const onPromote = vi.fn();
    render(
      <WaitlistRosterTable
        event={state.event}
        registrations={[
          { ...base, registeredAt: '2026-05-01T00:00:00Z' },
          {
            _docId: 'regC',
            userId: 'uidC',
            userName: '小華',
            status: 'waitlisted',
            participantType: 'self',
            registeredAt: '2026-06-01T00:00:00Z',
          },
        ]}
        roles={{}}
        onOpenProfile={vi.fn()}
        editing
        rosterContext={state.context}
        onPromoteParticipant={onPromote}
      />,
    );
    expect(screen.getByRole('columnheader', { name: '正取' })).toBeTruthy();
    const button = screen.getByRole('button', { name: '將 小明 正取' });
    const promoteCell = button.closest('td');
    expect(promoteCell?.classList.contains('att-wl-link')).toBe(false);
    expect(promoteCell?.querySelector('.att-no')).toBeNull();
    expect(promoteCell?.parentElement?.querySelector('.att-wl-name.att-wl-link')).toBeTruthy();
    fireEvent.click(button);
    expect(onPromote).toHaveBeenCalledOnce();
    expect(onPromote.mock.calls[0]?.[0]).toMatchObject({ userId: 'uidB', name: '小明' });
  });

  it('候補樣式檔含紫色變數與虛線連線', () => {
    const css = readFileSync(resolve(__dirname, 'waitlist-roster.css'), 'utf8');
    const source = readFileSync(resolve(__dirname, 'WaitlistRosterTable.tsx'), 'utf8');
    expect(css).toContain('--wl');
    expect(css).toContain('dotted');
    expect(css).toContain('#7e22ce');
    expect(css).toContain('#c4a3ff');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('站長 2026-11-10 選定 W3；R-UI-005 例外（沿用候補一貫的紫色）');
    expect(source).toContain("import './companion-roster.css'");
    expect(source).toContain("import './waitlist-roster.css'");
    expect(css).not.toContain('.att-zebra-odd');
  });
});


describe('T-074b 快速調整', () => {
  it('只在該隊獲准且非送出時顯示，點擊傳 teamId', () => {
    const onAdjust = vi.fn();
    // 名單沿用伺服器投影的 remainingSlots；只有保留席位、沒有報名者時仍應顯示隊伍列。
    const props = { event: { id: 'e1', max: 10, teamReservationSummaries: [
      { teamId: 't1', teamName: '一隊', reservedSlots: 2, usedSlots: 0, remainingSlots: 2 },
      { teamId: 't2', teamName: '二隊', reservedSlots: 2, usedSlots: 0, remainingSlots: 2 },
    ] }, registrations: [], attendanceRecords: [], roles: {}, onOpenProfile: vi.fn(),
    canAdjustTeamReservation: (id: string) => id === 't2', onAdjustTeamReservation: onAdjust };
    const view = render(<AttendanceRosterTable {...props} publicRosterOnly />);
    expect(screen.getByText('一隊')).toBeTruthy();
    expect(screen.getByText('二隊')).toBeTruthy();
    const button = screen.getByRole('button', { name: '快速調整' });
    expect(button.textContent).toBe('調整');
    expect(button.closest('tr')?.textContent).toContain('二隊');
    fireEvent.click(button); expect(onAdjust).toHaveBeenCalledWith('t2');
    expect(onAdjust).toHaveBeenCalledTimes(1);
    view.rerender(<AttendanceRosterTable {...props} publicRosterOnly submitting />);
    expect(screen.getByText('二隊')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '快速調整' })).toBeNull();
    view.rerender(<AttendanceRosterTable {...props} canAdjustTeamReservation={() => false} />);
    expect(screen.getByText('二隊')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '快速調整' })).toBeNull();
  });
});

describe('座位點標頭（站長 11-06 選風格 B）', () => {
  function renderSummary(reservedSlots: number, usedSlots: number, remainingSlots: number, members = 0) {
    // 沒有剩餘席位時，model 只在有隊員報名時才畫標頭，所以超用情境要帶隊員報名。
    const registrations = Array.from({ length: members }, (_, i) => ({
      _docId: `r${i}`, userId: `u${i}`, userName: `隊員${i}`, status: 'confirmed', participantType: 'self',
      teamReservationTeamId: 't1', teamReservationTeamName: '飛鷹FC',
    }));
    return render(<AttendanceRosterTable publicRosterOnly event={{ id: 'e1', max: 30, teamReservationSummaries: [
      { teamId: 't1', teamName: '飛鷹FC', reservedSlots, usedSlots, remainingSlots },
    ] }} registrations={registrations} attendanceRecords={[]} roles={{}} onOpenProfile={vi.fn()} />);
  }

  it('實心點＝已使用、空心點＝剩餘，旁邊「剩 N」，頭像取隊名首字', () => {
    const { container } = renderSummary(5, 2, 3);
    expect(container.querySelectorAll('.team-reservation-seat-dots i')).toHaveLength(5);
    expect(container.querySelectorAll('.team-reservation-seat-dots i.is-used')).toHaveLength(2);
    expect(container.querySelector('.team-reservation-seat-left')?.textContent).toBe('剩 3');
    expect(screen.getByLabelText('佔位 5，已使用 2，剩餘 3')).toBeTruthy();
    expect(container.querySelector('.team-reservation-section-avatar')?.textContent).toBe('飛');
    expect(screen.queryByText(/佔位: /)).toBeNull();
  });

  it('超過 10 位改顯示「已用／總數」，不畫圓點', () => {
    const { container } = renderSummary(12, 4, 8);
    expect(container.querySelector('.team-reservation-seat-dots')).toBeNull();
    expect(container.querySelector('.team-reservation-seat-count')?.textContent).toBe('4/12');
    expect(container.querySelector('.team-reservation-seat-left')?.textContent).toBe('剩 8');
  });

  it('已使用超過佔位（後端允許超用）不截斷，改顯示「已用／總數」', () => {
    const { container } = renderSummary(3, 5, 0, 5);
    expect(container.querySelector('.team-reservation-seat-dots')).toBeNull();
    expect(container.querySelector('.team-reservation-seat-count')?.textContent).toBe('5/3');
    expect(screen.getByLabelText('佔位 3，已使用 5，剩餘 0')).toBeTruthy();
  });
});
