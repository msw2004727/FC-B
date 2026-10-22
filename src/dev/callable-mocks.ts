// 只供本機瀏覽器實測，正式 build 不含。
// ASSUMPTION: 正式建置的 VITE_CALLABLE_MODE 不為 'mock'，由 Vite 移除動態載入分支。

import { registerMock } from '@/data/callables';
import type { ConfirmEventAttendanceDesiredState } from '@/data/contract/callables';

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
