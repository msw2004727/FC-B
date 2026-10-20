import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { AttendanceRosterTable } from './AttendanceRosterTable';
import { WaitlistRosterTable } from './WaitlistRosterTable';

vi.mock('@/i18n/i18n', async (importOriginal) => {
  const dict: Record<string, string> = {
    'ui.userTag.role.user': '一般用戶',
    'ui.userTag.role.coach': '教練',
    'ui.userTag.openProfile': '檢視 {name}',
    'ui.userTag.unknown': '未知用戶',
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
    render(
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
    expect(screen.getByText('FC One 保留席位')).toBeTruthy();
    expect(screen.getByText('保留席位')).toBeTruthy();
    expect(screen.getByText('一般報名')).toBeTruthy();
    expect(screen.getByText('ProxyParent')).toBeTruthy();
    expect(screen.getByText('僅代報')).toBeTruthy();
    expect(screen.getByText('↳ Alice Kid')).toBeTruthy();
    expect(screen.getByText('↳ ProxyKid')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('遲到5分')).toBeTruthy();

    const userTagBtn = screen.getByRole('button', { name: /Alice/ });
    fireEvent.click(userTagBtn);
    expect(onOpenProfile).toHaveBeenCalledWith('u1');
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
    expect(screen.getByText('#')).toBeTruthy();
    expect(screen.getByText('姓名')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('↳ Alice Jr')).toBeTruthy();
    expect(screen.getAllByText('已正取').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/↳ 報名人：Alice/).length).toBeGreaterThanOrEqual(1);
  });
});
