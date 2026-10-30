import type { RosterStatusInput, RosterStatusSnapshot } from './roster-status';
import type { RosterStatusAction } from './roster-status-policy';
import type { ForceDemoteToWaitlistAppliedResponse, ForcePromoteWaitlistAppliedResponse } from '@/data/contract/callables';
import zh from '../locales/zh-TW.json';

export function translate(key: string, params?: Record<string, string | number>): string {
  const dictionary = zh.roster as Record<string, string>;
  return (dictionary[key.replace('events.roster.', '')] || key)
    .replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '{' + name + '}'));
}
export function snapshot(action: RosterStatusAction = 'demote'): RosterStatusSnapshot {
  return {
    event: { id: 'evtA', title: '週末活動', max: 2, creatorUid: 'uidA' },
    context: { uid: 'uidA', role: 'admin', rolePermissions: ['event.edit_all'],
      userGrants: null, capabilities: [], customRoles: [] },
    operatorName: '管理員甲',
    registrations: [{ _docId: 'regA', userId: 'uidB', userName: '小明',
      status: action === 'demote' ? 'confirmed' : 'waitlisted', participantType: 'self' }],
  };
}
const occupancy = {
  current: 4, realCurrent: 1, waitlist: 1, status: 'open', participants: ['小明'],
  waitlistNames: [], participantsWithUid: [{ uid: 'uidB', name: '小明' }],
  waitlistWithUid: [], teamReservationSummaries: [{ teamId: 'teamA', remainingSlots: 3 }],
};
export const demoted: ForceDemoteToWaitlistAppliedResponse = {
  success: true, demoted: 1, current: 4, waitlist: 1, status: 'open', event: occupancy,
};
export const promoted: ForcePromoteWaitlistAppliedResponse = {
  success: true, promoted: 1, current: 4, waitlist: 0, status: 'full', overCapacity: true, event: occupancy,
};
export function inputFor(action: RosterStatusAction = 'demote'): RosterStatusInput {
  const state = snapshot(action);
  return {
    action, eventId: 'evtA', target: { userId: 'uidB', name: '小明' },
    getLatest: () => state, reload: async () => state,
    refreshPermissions: () => {}, flush: async () => {}, confirm: async () => true, t: translate,
  };
}
