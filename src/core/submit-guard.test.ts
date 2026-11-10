import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateReloadSafety } from './reload-safety';
import {
  _resetSubmitGuardForTest,
  beginSubmitting,
  isSubmitting,
  onSubmittingIdle,
  withSubmitting,
} from './submit-guard';

describe('submit-guard（T6）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSubmitGuardForTest();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-submitting');
    document.documentElement.removeAttribute('aria-busy');
  });

  afterEach(() => {
    _resetSubmitGuardForTest();
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-submitting');
  });

  it('標記期間安全判斷是 write-pending，html 有 data-submitting、沒有 aria-busy', () => {
    const release = beginSubmitting('signup');
    expect(isSubmitting()).toBe(true);
    expect(document.documentElement.getAttribute('data-submitting')).toBe('true');
    expect(document.documentElement.hasAttribute('aria-busy')).toBe(false);
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: false, reason: 'write-pending' });
    document.documentElement.removeAttribute('data-submitting');
    expect(evaluateReloadSafety({ currentPath: '/' }).reason).toBe('write-pending');
    release();
    expect(isSubmitting()).toBe(false);
    expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: true });
  });

  it('release 呼叫兩次只減一次', () => {
    const idle = vi.fn();
    onSubmittingIdle(idle);
    const first = beginSubmitting('signup');
    const second = beginSubmitting('cancel');
    first();
    first();
    expect(isSubmitting()).toBe(true);
    expect(idle).not.toHaveBeenCalled();
    second();
    second();
    expect(isSubmitting()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('預設 90 秒自動釋放並 console.warn，歸零觸發 onSubmittingIdle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const idle = vi.fn();
    onSubmittingIdle(idle);
    beginSubmitting('attendance-save');
    await vi.advanceTimersByTimeAsync(89_999);
    expect(isSubmitting()).toBe(true);
    expect(idle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(isSubmitting()).toBe(false);
    expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
    expect(warn).toHaveBeenCalledWith('[submit-guard] 逾時釋放', 'attendance-save');
    expect(idle).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('withSubmitting 在 fn 丟錯時仍釋放', async () => {
    await expect(withSubmitting('roster-remove', async () => {
      expect(isSubmitting()).toBe(true);
      throw new Error('callable 失敗');
    })).rejects.toThrow(/callable 失敗/);
    expect(isSubmitting()).toBe(false);
    expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
  });

  it('withSubmitting 成功後釋放，取消訂閱後不再通知', async () => {
    const idle = vi.fn();
    const unsub = onSubmittingIdle(idle);
    await withSubmitting('event-save', async () => 'ok');
    expect(idle).toHaveBeenCalledTimes(1);
    expect(isSubmitting()).toBe(false);
    unsub();
    const release = beginSubmitting('checkin');
    release();
    expect(idle).toHaveBeenCalledTimes(1);
  });
});
