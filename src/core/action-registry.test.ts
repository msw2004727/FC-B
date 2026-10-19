import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearMessageActions,
  getMessageAction,
  registerMessageAction,
  type MessageActionHandler,
} from './action-registry';

describe('action-registry', () => {
  beforeEach(() => {
    clearMessageActions();
  });

  it('registers and retrieves a handler by actionType', () => {
    const handler: MessageActionHandler = {
      canAct: () => true,
      actions: [
        {
          key: 'approve',
          labelKey: 'inbox.action.approve',
          run: async () => undefined,
        },
      ],
    };
    registerMessageAction('team_join_request', handler);
    expect(getMessageAction('team_join_request')).toBe(handler);
  });

  it('returns null for unknown actionType', () => {
    expect(getMessageAction('unknown')).toBeNull();
  });

  it('returns null for empty actionType', () => {
    expect(getMessageAction('')).toBeNull();
  });

  it('replaces handler when registering same actionType twice', () => {
    const first: MessageActionHandler = { canAct: () => true, actions: [] };
    const second: MessageActionHandler = { canAct: () => false, actions: [] };
    registerMessageAction('a', first);
    registerMessageAction('a', second);
    expect(getMessageAction('a')).toBe(second);
  });

  it('throws when registering empty actionType', () => {
    const handler: MessageActionHandler = { canAct: () => true, actions: [] };
    expect(() => registerMessageAction('', handler)).toThrow();
  });

  it('supports async canAct handlers', async () => {
    const handler: MessageActionHandler = {
      canAct: async () => true,
      actions: [],
    };
    registerMessageAction('async_type', handler);
    const retrieved = getMessageAction('async_type');
    expect(retrieved).toBe(handler);
    const value = await retrieved!.canAct({ uid: 'u1' }, { id: 'm1' });
    expect(value).toBe(true);
  });

  it('clearMessageActions empties the registry', () => {
    registerMessageAction('x', { canAct: () => true, actions: [] });
    clearMessageActions();
    expect(getMessageAction('x')).toBeNull();
  });
});
