import { describe, expect, it } from 'vitest';
import { checkEmuReport } from './check-emu-report.mjs';

const ok = { success: true, numTotalTests: 32, numPassedTests: 32, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 };

describe('check-emu-report', () => {
  it('全部通過且條數足夠才算過', () => {
    expect(checkEmuReport(ok, 32).ok).toBe(true);
  });

  it('模擬器沒連上、整檔略過（vitest 仍 success）要算失敗', () => {
    const r = checkEmuReport({ ...ok, numPassedTests: 0, numPendingTests: 32 }, 32);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('略過 32');
  });

  it('有失敗、條數不足或 success 不是 true 都算失敗', () => {
    expect(checkEmuReport({ ...ok, success: false, numFailedTests: 1, numPassedTests: 31 }, 32).ok).toBe(false);
    expect(checkEmuReport({ ...ok, numTotalTests: 20, numPassedTests: 20 }, 32).ok).toBe(false);
    expect(checkEmuReport({}, 1).ok).toBe(false);
  });
});
