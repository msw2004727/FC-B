import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMessageActions,
  ensureMessageAction,
  getMessageAction,
  registerMessageAction,
  type MessageActionHandler,
} from './action-registry';
import { _resetForTest, registerFeatures, setRemoteFlags } from './feature-registry';

describe('action-registry', () => {
  beforeEach(() => {
    clearMessageActions();
    _resetForTest();
  });

  const dummyHandler: MessageActionHandler = {
    canAct: () => true,
    actions: [
      {
        key: 'approve',
        labelKey: 'inbox.action.approve',
        run: async () => {},
      },
    ],
  };

  it('registers and retrieves message actions synchronously', () => {
    expect(getMessageAction('team_join_request')).toBeNull();
    registerMessageAction('team_join_request', dummyHandler);
    expect(getMessageAction('team_join_request')).toBe(dummyHandler);
  });

  it('throws when registering empty actionType', () => {
    expect(() => registerMessageAction('   ', dummyHandler)).toThrow(
      'registerMessageAction: actionType is required',
    );
  });

  it('returns null for empty actionType in getMessageAction and ensureMessageAction', async () => {
    expect(getMessageAction('')).toBeNull();
    expect(await ensureMessageAction('  ')).toBeNull();
  });

  it('ensureMessageAction returns existing handler without calling manifest loader', async () => {
    registerMessageAction('team_join_request', dummyHandler);
    const loader = vi.fn(async () => {});
    registerFeatures([
      {
        id: 'clubs',
        status: 'enabled',
        routes: [],
        messageActions: {
          team_join_request: loader,
        },
      },
    ]);

    const result = await ensureMessageAction('team_join_request');
    expect(result).toBe(dummyHandler);
    expect(loader).not.toHaveBeenCalled();
  });

  it('ensureMessageAction dynamically loads handler from enabled manifest and only loads once', async () => {
    const loader = vi.fn(async () => {
      registerMessageAction('team_join_request', dummyHandler);
    });

    registerFeatures([
      {
        id: 'clubs',
        status: 'enabled',
        routes: [],
        messageActions: {
          team_join_request: loader,
        },
      },
    ]);

    const [first, second] = await Promise.all([
      ensureMessageAction('team_join_request'),
      ensureMessageAction('team_join_request'),
    ]);
    const third = await ensureMessageAction('team_join_request');

    expect(first).toBe(dummyHandler);
    expect(second).toBe(dummyHandler);
    expect(third).toBe(dummyHandler);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('ensureMessageAction returns null and does not throw when loader fails, and only loads once', async () => {
    const loader = vi.fn(async () => {
      throw new Error('network error');
    });

    registerFeatures([
      {
        id: 'clubs',
        status: 'enabled',
        routes: [],
        messageActions: {
          broken_action: loader,
        },
      },
    ]);

    const first = await ensureMessageAction('broken_action');
    const second = await ensureMessageAction('broken_action');

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('ensureMessageAction ignores disabled features', async () => {
    const loader = vi.fn(async () => {
      registerMessageAction('disabled_action', dummyHandler);
    });

    registerFeatures([
      {
        id: 'disabled-feature',
        status: 'enabled',
        routes: [],
        messageActions: {
          disabled_action: loader,
        },
      },
    ]);
    setRemoteFlags({ 'disabled-feature': false });

    const res = await ensureMessageAction('disabled_action');
    expect(res).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });
});
