import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emit,
  off,
  on,
  setEventErrorReporter,
  type AppEvents,
} from '@/core/events';

const disposers: Array<() => void> = [];

const defaultErrorReporter = (error: unknown): void => {
  console.error('[events] listener error', error);
};

function subscribe<K extends keyof AppEvents>(
  type: K,
  handler: (payload: AppEvents[K]) => void,
): () => void {
  const dispose = on(type, handler);
  disposers.push(dispose);
  return dispose;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  setEventErrorReporter(defaultErrorReporter);
  vi.restoreAllMocks();
});

describe('events', () => {
  it('on 與 emit 會傳遞正確的 payload', () => {
    const handler = vi.fn();
    subscribe('registration:created', handler);

    const payload = { eventId: 'event-1', userId: 'user-1' };
    emit('registration:created', payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('off 之後不再收到事件', () => {
    const handler = vi.fn();
    subscribe('checkin:recorded', handler);

    emit('checkin:recorded', { eventId: 'event-1', uid: 'user-1' });
    expect(handler).toHaveBeenCalledTimes(1);

    off('checkin:recorded', handler);
    emit('checkin:recorded', { eventId: 'event-2', uid: 'user-2' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('同一事件可以有多個 listener', () => {
    const first = vi.fn();
    const second = vi.fn();

    subscribe('theme:changed', first);
    subscribe('theme:changed', second);

    const payload = { theme: 'dark' as const };
    emit('theme:changed', payload);

    expect(first).toHaveBeenCalledWith(payload);
    expect(second).toHaveBeenCalledWith(payload);
  });

  it('第一個 listener 丟錯時，後續 listener 仍收到同一 payload，錯誤回報入口被呼叫一次', () => {
    const reporter = vi.fn();
    setEventErrorReporter(reporter);

    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();

    subscribe('theme:changed', first);
    subscribe('theme:changed', second);

    const payload = { theme: 'dark' as const };
    emit('theme:changed', payload);

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(payload);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(expect.any(Error));
  });

  it('emit 期間移除的 listener 本次仍收到，新增的 listener 本次不收到', () => {
    const removed = vi.fn();
    const added = vi.fn();
    let firstRun = true;

    const first = vi.fn(() => {
      if (!firstRun) return;
      firstRun = false;
      off('theme:changed', removed);
      subscribe('theme:changed', added);
    });

    subscribe('theme:changed', first);
    subscribe('theme:changed', removed);

    emit('theme:changed', { theme: 'light' });

    expect(removed).toHaveBeenCalledTimes(1);
    expect(added).not.toHaveBeenCalled();
  });
});
