import { describe, expect, it } from 'vitest';
import {
  canRemoveConfirmedParticipant,
  canRemoveWaitlistedParticipant,
  type OperateContext,
  type OperateEvent,
} from './operate-permissions';

function makeContext(overrides: Partial<OperateContext> = {}): OperateContext {
  return {
    uid: 'u_actor',
    role: 'user',
    rolePermissions: null,
    userGrants: null,
    capabilities: [],
    customRoles: [],
    ...overrides,
  };
}

const baseEvent: OperateEvent = {
  creatorUid: 'u_owner',
  delegateUids: ['u_delegate'],
  privateEvent: false,
};

describe('canRemoveWaitlistedParticipant (A _canRemoveWaitlistedParticipant)', () => {
  it('denies guest / unready context or null event', () => {
    expect(
      canRemoveWaitlistedParticipant(makeContext({ uid: null, role: null }), baseEvent),
    ).toBe(false);
    expect(canRemoveWaitlistedParticipant(makeContext({ role: 'admin' }), null)).toBe(false);
  });

  it('allows admin and super_admin via event.edit_all across any event', () => {
    const adminCtx = makeContext({
      uid: 'u_admin',
      role: 'admin',
      rolePermissions: ['event.edit_all'],
    });
    const superCtx = makeContext({
      uid: 'u_super',
      role: 'super_admin',
      rolePermissions: ['event.edit_all'],
    });
    expect(canRemoveWaitlistedParticipant(adminCtx, baseEvent)).toBe(true);
    expect(canRemoveWaitlistedParticipant(superCtx, baseEvent)).toBe(true);
  });

  it('allows coach with scope (owner or delegate) and denies coach without scope', () => {
    const coachNoScope = makeContext({
      uid: 'u_coach_other',
      role: 'coach',
      rolePermissions: [],
    });
    const coachOwner = makeContext({
      uid: 'u_owner',
      role: 'coach',
      rolePermissions: [],
    });
    const coachDelegate = makeContext({
      uid: 'u_delegate',
      role: 'coach',
      rolePermissions: [],
    });

    expect(canRemoveWaitlistedParticipant(coachNoScope, baseEvent)).toBe(false);
    expect(canRemoveWaitlistedParticipant(coachOwner, baseEvent)).toBe(true);
    expect(canRemoveWaitlistedParticipant(coachDelegate, baseEvent)).toBe(true);
  });

  it('allows owner user with user.activity.site_operate and denies without it', () => {
    const ownerWithoutCap = makeContext({
      uid: 'u_owner',
      role: 'user',
      rolePermissions: [],
      capabilities: [],
    });
    const ownerWithCap = makeContext({
      uid: 'u_owner',
      role: 'user',
      rolePermissions: [],
      capabilities: ['user.activity.site_operate'],
    });

    expect(canRemoveWaitlistedParticipant(ownerWithoutCap, baseEvent)).toBe(false);
    expect(canRemoveWaitlistedParticipant(ownerWithCap, baseEvent)).toBe(true);
  });

  it('allows user delegate even without user.activity.site_operate (R-IAM-013), while confirmed requires site_operate', () => {
    const delegateNoCap = makeContext({
      uid: 'u_delegate',
      role: 'user',
      rolePermissions: [],
      capabilities: [],
    });
    const delegateWithCap = makeContext({
      uid: 'u_delegate',
      role: 'user',
      rolePermissions: [],
      capabilities: ['user.activity.site_operate'],
    });

    expect(canRemoveWaitlistedParticipant(delegateNoCap, baseEvent)).toBe(true);
    expect(canRemoveConfirmedParticipant(delegateNoCap, baseEvent)).toBe(false);
    expect(canRemoveConfirmedParticipant(delegateWithCap, baseEvent)).toBe(true);
  });

  it('denies non-scoped user even if user.activity.site_operate is enabled', () => {
    const strangerWithCap = makeContext({
      uid: 'u_stranger',
      role: 'user',
      rolePermissions: [],
      capabilities: ['user.activity.site_operate'],
    });
    expect(canRemoveWaitlistedParticipant(strangerWithCap, baseEvent)).toBe(false);
  });
});
