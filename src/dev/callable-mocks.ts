// 只供本機瀏覽器實測，正式 build 不含。
// ASSUMPTION: 正式建置的 VITE_CALLABLE_MODE 不為 'mock'，由 Vite 移除動態載入分支。

import { registerMock } from '@/data/callables';
import type { ConfirmEventAttendanceDesiredState } from '@/data/contract/callables';

const mockEventViewCounts = new Map<string, number>();

registerMock('incrementEventViewCount', async (req) => {
  const [{ getFirebase }, fs] = await Promise.all([
    import('@/data/firebase'),
    import('firebase/firestore'),
  ]);
  const firebase = await getFirebase();
  const snapshot = await fs.getDoc(fs.doc(firebase.db, 'events', req.docId));
  const value: unknown = snapshot.exists() ? snapshot.data().viewCount : 0;
  const numeric = Number(value || 0);
  const stored = Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
  const key = JSON.stringify([req.eventId, req.docId]);
  const viewCount = Math.max(stored, mockEventViewCounts.get(key) ?? 0) + 1;
  mockEventViewCounts.set(key, viewCount);
  return { incremented: true, viewCount };
});

function isFailureEnabled(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

registerMock('confirmEventAttendance', async (req) => {
  if (isFailureEnabled('fcb:mock:settleFail')) {
    throw Object.assign(new Error('mock：結算失敗'), { code: 'internal' });
  }

  const entries: Array<[string, ConfirmEventAttendanceDesiredState]> =
    Array.isArray(req.desired)
      ? req.desired.map((state): [string, ConfirmEventAttendanceDesiredState] => [
          state.uid,
          state,
        ])
      : Object.entries(req.desired);

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 600);
  });

  return {
    success: true,
    added: entries.filter(([, state]) => state.checkin === true).length,
    removed: 0,
    expTargets: entries
      .filter(([key, state]) =>
        state.checkin === true
        && state.checkout === true
        && !key.startsWith('comp')
        && !key.includes('_'),
      )
      .map(([key]) => key),
  };
});

registerMock('adjustExp', (req) => {
  if (isFailureEnabled('fcb:mock:adjustExpFail')) {
    throw Object.assign(new Error('mock：經驗值發放失敗'), { code: 'internal' });
  }

  return {
    success: true,
    results: (req.targets ?? []).map((id) => ({
      targetId: id,
      success: true,
      oldExp: 0,
      newExp: req.amount,
    })),
  };
});

// T-005b：報名／取消流程本機實測用；不寫 Firestore，只回 A Callable 成功形狀。
// `fcb:mock:signupWaitlist=1` 回候補、`fcb:mock:signupFail=1` 回失敗。
registerMock('registerForEvent', async (req) => {
  if (isFailureEnabled('fcb:mock:signupFail')) {
    throw Object.assign(new Error('mock：報名失敗'), { code: 'internal' });
  }
  const status = isFailureEnabled('fcb:mock:signupWaitlist') ? 'waitlisted' : 'confirmed';
  const registrations = req.participants.map((person, index) => ({
    id: `reg_mock_${index}`,
    eventId: req.eventId,
    userId: person.userId,
    participantType: person.companionId ? 'companion' : 'self',
    companionId: person.companionId,
    status,
  }));
  return {
    success: true,
    registrations,
    confirmed: status === 'confirmed' ? registrations.length : 0,
    waitlisted: status === 'waitlisted' ? registrations.length : 0,
    earlyBirdCharged: req.earlyBirdAccepted === true,
    earlyBirdCost: req.earlyBirdAccepted === true ? Number(req.earlyBirdExpectedCost || 0) : 0,
  };
});

registerMock('cancelRegistration', async (req) => {
  if (isFailureEnabled('fcb:mock:cancelFail')) {
    throw Object.assign(new Error('mock：取消失敗'), { code: 'internal' });
  }
  return { success: true, cancelled: req.registrationIds, alreadyCancelled: [], promoted: [] };
});
