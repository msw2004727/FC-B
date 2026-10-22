import { describe, expect, it } from 'vitest';
import type { RegistrationDoc } from './types';
import { getViewerEventRegState } from './viewer-reg-state';

describe('getViewerEventRegState (A M-080)', () => {
  const event = { id: 'public-1' };

  it('returns not-signed-up when viewerUid is empty', () => {
    expect(getViewerEventRegState(event, null, [])).toEqual({ signedUp: false, onWaitlist: false });
    expect(getViewerEventRegState(event, '', [])).toEqual({ signedUp: false, onWaitlist: false });
  });

  it('returns not-signed-up when event.id is missing', () => {
    expect(getViewerEventRegState({}, 'u1', [])).toEqual({ signedUp: false, onWaitlist: false });
  });

  it('matches an active confirmed registration and reports signedUp', () => {
    const regs: RegistrationDoc[] = [
      { eventId: 'public-1', userId: 'u1', status: 'confirmed' },
    ];
    expect(getViewerEventRegState(event, 'u1', regs)).toEqual({ signedUp: true, onWaitlist: false });
  });

  it('excludes companion registrations (participantType=companion)', () => {
    const regs: RegistrationDoc[] = [
      { eventId: 'public-1', userId: 'u1', status: 'confirmed', participantType: 'companion' },
    ];
    expect(getViewerEventRegState(event, 'u1', regs)).toEqual({ signedUp: false, onWaitlist: false });
  });

  it('excludes companion registrations (companionId is set)', () => {
    const r: RegistrationDoc & { companionId?: string } = {
      eventId: 'public-1', userId: 'u1', status: 'confirmed', companionId: 'c1',
    };
    expect(getViewerEventRegState(event, 'u1', [r])).toEqual({ signedUp: false, onWaitlist: false });
  });

  it('ignores cancelled/removed registrations', () => {
    const regs: RegistrationDoc[] = [
      { eventId: 'public-1', userId: 'u1', status: 'cancelled' },
      { eventId: 'public-1', userId: 'u1', status: 'removed' },
    ];
    expect(getViewerEventRegState(event, 'u1', regs)).toEqual({ signedUp: false, onWaitlist: false });
  });

  it('reports onWaitlist when the only active reg is waitlisted', () => {
    const regs: RegistrationDoc[] = [
      { eventId: 'public-1', userId: 'u1', status: 'waitlisted' },
    ];
    expect(getViewerEventRegState(event, 'u1', regs)).toEqual({ signedUp: true, onWaitlist: true });
  });

  it('matches courseOwnerUids as the viewer owner', () => {
    const r: RegistrationDoc & { courseOwnerUids: string[] } = {
      eventId: 'public-1', status: 'confirmed', courseOwnerUids: ['u1'],
    };
    expect(getViewerEventRegState(event, 'u1', [r])).toEqual({ signedUp: true, onWaitlist: false });
  });

  it('does NOT match ownerUid (A never uses ownerUid for the viewer)', () => {
    const r: RegistrationDoc = {
      eventId: 'public-1', ownerUid: 'u1', status: 'confirmed',
    };
    expect(getViewerEventRegState(event, 'u1', [r])).toEqual({ signedUp: false, onWaitlist: false });
  });

  it('falls back to event.waitlistWithUid', () => {
    const ev = { id: 'public-1', waitlistWithUid: [{ uid: 'u1' }] };
    expect(getViewerEventRegState(ev, 'u1', [])).toEqual({ signedUp: true, onWaitlist: true });
  });

  it('falls back to event.participantsWithUid', () => {
    const ev = { id: 'public-1', participantsWithUid: [{ userId: 'u1' }] };
    expect(getViewerEventRegState(ev, 'u1', [])).toEqual({ signedUp: true, onWaitlist: false });
  });

  it('prefers waitlistWithUid over participantsWithUid', () => {
    const ev = {
      id: 'public-1',
      waitlistWithUid: [{ uid: 'u1' }],
      participantsWithUid: [{ uid: 'u1' }],
    };
    expect(getViewerEventRegState(ev, 'u1', [])).toEqual({ signedUp: true, onWaitlist: true });
  });

  it('does not match other users', () => {
    const regs: RegistrationDoc[] = [
      { eventId: 'public-1', userId: 'someone-else', status: 'confirmed' },
    ];
    expect(getViewerEventRegState(event, 'u1', regs)).toEqual({ signedUp: false, onWaitlist: false });
  });
});
