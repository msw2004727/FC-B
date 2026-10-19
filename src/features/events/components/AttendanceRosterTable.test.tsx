import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { AttendanceRosterTable } from './AttendanceRosterTable';
import { WaitlistRosterTable } from './WaitlistRosterTable';

vi.mock('@/i18n/i18n', async (importOriginal) => {
  const dict: Record<string, string> = {
    'events.roster.title': '報名名單（{count}/{max}）',
    'events.roster.checkin': '簽到',
    'events.roster.checkout': '簽退',
    'events.roster.note': '備註',
    'events.roster.empty': '尚無報名',
    'events.roster.reservedSeat': '保留席位',
    'events.roster.proxyOnly': '僅代報',
    'events.roster.courseRollcall': '請至課程點名',
    'events.roster.generalSection': '一般報名',
    'events.roster.clubBadge': '俱',
    'events.roster.reservedSlots': '佔位: {count}',
    'events.roster.usedSlots': '已使用: {count}',
    'events.roster.remainingSlots': '剩餘: {count}',
    'events.roster.waitlistTitle': '候補名單（{count}）',
    'events.roster.waitlistNumber': '#',
    'events.roster.waitlistName': '姓名',
    'events.roster.orphanPrefix': '↳ 報名人：{name}（',
    'events.roster.orphanConfirmed': '已正取',
    'events.roster.orphanSuffix': '）',
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
  });
});
