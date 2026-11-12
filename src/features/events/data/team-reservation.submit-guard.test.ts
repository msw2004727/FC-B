/** 俱樂部名額保留寫入進行中要擋住強制更新，成功與失敗都釋放。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/callables', () => ({ callFn: vi.fn(), CallableError: class extends Error {} }));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn() }));
vi.mock('firebase/firestore', () => ({ getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn() }));

import { callFn } from '@/data/callables';
import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import {
  createTeamReservationController, type TeamReservationEvent, type TeamReservationViewer,
} from './team-reservation';

const now = Date.parse('2026-11-04T00:00:00Z');
const viewer: TeamReservationViewer = {
  uid: 'u1', teamIds: new Set(['t1']), staffTeams: [{ id: 't1', name: '一隊' }],
};
const event: TeamReservationEvent = {
  id: 'event-public', _docId: 'event-document', status: 'open', current: 28, max: 30,
  teamReservationSummaries: [{ teamId: 't1', teamName: '一隊', reservedSlots: 8, usedSlots: 3 }],
};
const occupancy = {
  current: 27, realCurrent: 20, waitlist: 0, status: 'open', participants: [], waitlistNames: [],
  participantsWithUid: [], waitlistWithUid: [],
  teamReservationSummaries: [{ teamId: 't1', reservedSlots: 7, usedSlots: 3, remainingSlots: 4, occupiedSlots: 7 }],
};

function makeController() {
  return createTeamReservationController(
    () => ({ event, viewer, generation: 1 }),
    { storage: { getItem: vi.fn(() => null), setItem: vi.fn() }, now: () => now, randomSuffix: () => 'abc' },
  );
}

beforeEach(() => {
  vi.mocked(callFn).mockReset();
  _resetSubmitGuardForTest();
});

describe('adjustTeamReservation 送出中', () => {
  it('呼叫進行中為 true，成功後釋放', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(callFn).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const operation = makeController().submit('t1', 7);
    await vi.waitFor(() => expect(callFn).toHaveBeenCalledTimes(1));
    expect(isSubmitting()).toBe(true);
    resolve({ success: true, event: occupancy, promoted: [] });
    await expect(operation).resolves.toMatchObject({ status: 'success' });
    expect(isSubmitting()).toBe(false);
  });

  it('呼叫丟錯後也釋放', async () => {
    vi.mocked(callFn).mockRejectedValue(new Error('boom'));
    await expect(makeController().submit('t1', 7)).resolves.toMatchObject({ status: 'error' });
    expect(isSubmitting()).toBe(false);
  });
});
