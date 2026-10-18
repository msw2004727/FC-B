import type { ComponentChildren } from 'preact';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperateContext } from '@/features/events/data/operate-permissions';
import type { EventDoc } from '@/features/events/data/types';
import type { EventAttendanceEntry } from './data/attendance';

const mocks = vi.hoisted(() => ({
  context: {
    uid: 'operator',
    role: 'user',
    rolePermissions: [],
    userGrants: null,
    capabilities: [],
    customRoles: [],
  } as OperateContext,
  documents: vi.fn(),
  registrations: vi.fn(),
  user: vi.fn(),
  attendance: vi.fn(),
  record: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/features/profile/data/viewer-operate', () => ({
  useOperateContext: () => mocks.context,
}));

vi.mock('./data/scan-reads', async (original) => {
  const actual = await original<typeof import('./data/scan-reads')>();
  return {
    ...actual,
    loadScanEventDocuments: mocks.documents,
    loadScanRegistrations: mocks.registrations,
    findScanUser: mocks.user,
  };
});

vi.mock('./data/attendance', async (original) => {
  const actual = await original<typeof import('./data/attendance')>();
  return {
    ...actual,
    loadEventAttendance: mocks.attendance,
    recordAttendance: mocks.record,
    removeAttendance: mocks.remove,
  };
});

vi.mock('@/ui/Text', () => ({
  Text: ({ children }: { children?: ComponentChildren }) => <span>{children}</span>,
}));

vi.mock('@/ui/EmptyState', () => ({
  EmptyState: ({ title, body }: { title?: string; body?: string }) => (
    <div data-testid="empty-state">{title}{body}</div>
  ),
}));

vi.mock('@/ui/UserTag', () => ({
  UserTag: ({ uid, name }: { uid: string; name?: string }) => (
    <span data-testid="user-tag" data-uid={uid}>{name}</span>
  ),
}));

vi.mock('@/ui/Modal', () => ({
  Modal: ({
    open, title, children, footer,
  }: {
    open: boolean;
    title: string;
    children?: ComponentChildren;
    footer?: ComponentChildren;
  }) => open ? (
    <div role="dialog" aria-label={title}>{children}{footer}</div>
  ) : null,
}));

import CheckinPage from './CheckinPage';

function event(id = 'public-event', docId = 'event-document'): EventDoc {
  const now = new Date();
  const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  return {
    id,
    _docId: docId,
    title: 'Training',
    date,
    delegateUids: ['operator'],
    participants: ['Member'],
    current: 1,
  } as unknown as EventDoc;
}

async function ready(): Promise<void> {
  await screen.findByRole('button', { name: 'Start camera scanning' });
}

async function submitUid(value = ' member '): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Enter user ID manually' }));
  fireEvent.input(screen.getByLabelText('Enter user ID manually'), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
}

describe('CheckinPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = 'en';
    mocks.context = {
      uid: 'operator',
      role: 'user',
      rolePermissions: [],
      userGrants: null,
      capabilities: [],
      customRoles: [],
    };
    mocks.documents.mockResolvedValue([event()]);
    mocks.registrations.mockResolvedValue([
      { userId: 'member', userName: 'Member', status: 'confirmed' },
    ]);
    mocks.user.mockResolvedValue({ uid: 'member', name: 'Member' });
    mocks.attendance.mockResolvedValue([]);
    mocks.record.mockResolvedValue('attendance-document');
    mocks.remove.mockResolvedValue(undefined);

    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['qr_code'];
      detect = async () => [];
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows EmptyState and no scanner without site permission', async () => {
    mocks.context = { ...mocks.context, uid: 'other-user' };
    render(<CheckinPage />);

    await waitFor(() => expect(mocks.documents).toHaveBeenCalled());
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start camera scanning' })).toBeNull();
    expect(document.querySelector('video')).toBeNull();
  });

  it('shows EmptyState when there are no events', async () => {
    mocks.documents.mockResolvedValue([]);
    render(<CheckinPage />);
    await waitFor(() => expect(mocks.documents).toHaveBeenCalled());
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
  });

  it('switches mode and performs checkout with automatic checkin', async () => {
    render(<CheckinPage />);
    await ready();

    const checkout = screen.getByRole('button', { name: 'Check-out', exact: true });
    fireEvent.click(checkout);
    expect(checkout.getAttribute('aria-pressed')).toBe('true');
    await submitUid();

    await screen.findByRole('dialog', {
      name: 'Automatically checked in and out',
    });
    expect(mocks.record.mock.calls.map((call) => call[1].type))
      .toEqual(['checkin', 'checkout']);
    expect(mocks.record.mock.calls[0]?.[0]).toBe('event-document');
    expect(mocks.record.mock.calls[0]?.[1]).toMatchObject({
      eventId: 'public-event',
      uid: 'member',
    });
  });

  it('validates blank UID, trims manual input and reloads results', async () => {
    render(<CheckinPage />);
    await ready();
    await submitUid('   ');

    expect(screen.getByText('Please enter a user ID.')).toBeTruthy();
    expect(mocks.user).not.toHaveBeenCalled();

    fireEvent.input(screen.getByLabelText('Enter user ID manually'), {
      target: { value: ' member ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByRole('dialog', { name: 'Check-in successful' });
    expect(mocks.user).toHaveBeenCalledWith('member', 'operator');
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.attendance.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(
      (screen.getByLabelText('Enter user ID manually') as HTMLInputElement).value,
    ).toBe('');
  });

  it('shows camera denial instructions and manual entry', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      new DOMException('Denied', 'NotAllowedError'),
    );
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    render(<CheckinPage />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera scanning' }));

    await screen.findByText(
      'Camera permission was denied. Allow access in browser settings or enter a user ID below.',
    );
    expect(screen.getByLabelText('Enter user ID manually')).toBeTruthy();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('releases camera tracks when leaving the page', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    const view = render(<CheckinPage />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera scanning' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    view.unmount();

    expect(stop).toHaveBeenCalledOnce();
  });

  it('confirms removal and uses the logged-in operator UID', async () => {
    const record: EventAttendanceEntry = {
      _docId: 'attendance-document',
      uid: 'member',
      userName: 'Member',
      companionId: null,
      companionName: null,
      displayName: 'Member',
      type: 'checkin',
      time: '2026/10/19 10:00',
      status: 'active',
      data: {},
    };
    mocks.attendance.mockResolvedValue([record]);

    render(<CheckinPage />);
    await ready();
    const remove = await screen.findByRole('button', { name: 'Cancel attendance' });
    fireEvent.click(remove);

    expect(mocks.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Cancel attendance' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(
      'event-document',
      'attendance-document',
      'operator',
    ));
  });

  it('uses family selection and preserves companion payload fields', async () => {
    mocks.registrations.mockResolvedValue([
      { userId: 'member', userName: 'Member', status: 'confirmed' },
      {
        userId: 'member',
        userName: 'Member',
        status: 'confirmed',
        companionId: 'child',
        companionName: 'Child',
      },
    ]);

    render(<CheckinPage />);
    await ready();
    await submitUid();

    const dialog = await screen.findByRole('dialog', {
      name: 'Family attendance · Check-in',
    });
    expect(mocks.record).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    expect(mocks.record.mock.calls[1]?.[1]).toMatchObject({
      uid: 'member',
      eventId: 'public-event',
      participantType: 'companion',
      companionId: 'child',
      companionName: 'Child',
    });
  });

  it('ignores a lookup that completes after changing the selected event', async () => {
    let resolveUser: ((value: { uid: string; name: string }) => void) | undefined;
    mocks.user.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    mocks.documents.mockResolvedValue([
      event(),
      { ...event('second-event', 'second-document'), title: 'Second' },
    ]);

    render(<CheckinPage />);
    const select = await screen.findByLabelText('Event');
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(3));

    fireEvent.change(select, { target: { value: 'public-event' } });
    await ready();
    await submitUid();

    fireEvent.change(select, { target: { value: 'second-event' } });
    await act(async () => {
      resolveUser?.({ uid: 'member', name: 'Member' });
      await Promise.resolve();
    });

    expect(mocks.record).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('supports retry after an initial event read failure', async () => {
    mocks.documents.mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([event()]);

    render(<CheckinPage />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    await ready();

    expect(mocks.documents).toHaveBeenCalledTimes(2);
  });
});
