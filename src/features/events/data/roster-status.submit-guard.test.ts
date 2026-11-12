/** 強制降候補／遞補寫入進行中要擋住強制更新，成功與失敗都釋放。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, registerMock, startRecording, stopRecording } from '@/data/callables';
import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import { adjustRosterStatus } from './roster-status';
import { demoted, inputFor } from './roster-status-test-fixtures';

vi.mock('@/data/op-log', () => ({ writeOpLog: vi.fn(async () => undefined) }));
vi.mock('@/data/roster-status-deployed', () => ({ ROSTER_STATUS_CALLABLES_DEPLOYED: true }));

beforeEach(() => {
  vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
  clearMocks();
  startRecording();
  _resetSubmitGuardForTest();
});
afterEach(() => {
  stopRecording();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetSubmitGuardForTest();
});

describe('adjustRosterStatus 送出中', () => {
  it('伺服器呼叫進行中為 true，成功後釋放', async () => {
    let seen = false;
    registerMock('forceDemoteToWaitlist', async () => {
      seen = isSubmitting();
      return demoted;
    });
    expect(isSubmitting()).toBe(false);
    const result = await adjustRosterStatus(inputFor('demote'));
    expect(result.tone).toBe('success');
    expect(seen).toBe(true);
    expect(isSubmitting()).toBe(false);
  });

  it('伺服器呼叫丟錯後也釋放', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let seen = false;
    registerMock('forceDemoteToWaitlist', async () => {
      seen = isSubmitting();
      throw new Error('boom');
    });
    const result = await adjustRosterStatus(inputFor('demote'));
    expect(result.tone).toBe('error');
    expect(seen).toBe(true);
    expect(isSubmitting()).toBe(false);
  });
});
