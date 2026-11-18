import { describe, expect, it } from 'vitest';

import type { PmAuditLog } from './pm-audit';
import {
  actionTone,
  canOpenConversation,
  collectLogUids,
  filterToPayload,
  isSelfAudit,
  shortUid,
  splitTargetUids,
  type PmAuditFilter,
} from './pm-audit-view';

const LONG_UID = 'U1111aaaa2222bbbb3333cccc4444dddd';

function makeAuditLog(over: Partial<PmAuditLog> = {}): PmAuditLog {
  return {
    key: 'k1',
    action: 'send',
    actorUid: 'A',
    targetUid: 'B',
    conversationId: 'c1',
    createdAtIso: '2026-11-19T04:00:00Z',
    createdAt: null,
    ...over,
  };
}

describe('聊天室稽核列純函式', () => {
  describe('filterToPayload', () => {
    const cases: Array<{ name: string; filter: PmAuditFilter; expected: Record<string, string> }> = [
      { name: '全部', filter: { kind: 'all' }, expected: {} },
      { name: '動作', filter: { kind: 'action', action: 'send' }, expected: { action: 'send' } },
      { name: '動作空值', filter: { kind: 'action', action: '' }, expected: {} },
      { name: '操作者', filter: { kind: 'actor', uid: 'U1' }, expected: { actorUid: 'U1' } },
      { name: '操作者空值', filter: { kind: 'actor', uid: '' }, expected: {} },
      { name: '對象', filter: { kind: 'target', uid: 'U2' }, expected: { targetUid: 'U2' } },
      { name: '對象空值', filter: { kind: 'target', uid: '' }, expected: {} },
    ];

    for (const c of cases) {
      it(`最多送出一個鍵：${c.name}`, () => {
        const payload = filterToPayload(c.filter);
        expect(payload).toEqual(c.expected);
        expect(Object.keys(payload).length).toBeLessThanOrEqual(1);
      });
    }
  });

  describe('shortUid', () => {
    it('長度不超過 12 原樣回傳', () => {
      expect(shortUid('abc')).toBe('abc');
      expect(shortUid('123456789012')).toBe('123456789012');
    });

    it('長度超過 12 取前 6 與後 4', () => {
      expect(shortUid(LONG_UID)).toBe('U1111a…dddd');
    });

    it('空字串回空字串', () => {
      expect(shortUid('')).toBe('');
      expect(shortUid('   ')).toBe('');
    });

    it('前後空白先去除', () => {
      expect(shortUid('  abc  ')).toBe('abc');
    });
  });

  describe('splitTargetUids', () => {
    it('逗號分隔拆成多個', () => {
      expect(splitTargetUids({ action: 'audit_view_conversation', targetUid: 'a,b' })).toEqual([
        'a',
        'b',
      ]);
    });

    it('去除空白並忽略空項目', () => {
      expect(splitTargetUids({ action: 'audit_view_conversation', targetUid: ' a , , b ' })).toEqual([
        'a',
        'b',
      ]);
    });

    it('空字串回空陣列', () => {
      expect(splitTargetUids({ action: 'send', targetUid: '' })).toEqual([]);
    });
  });

  describe('canOpenConversation', () => {
    const actions = ['send', 'read', 'edit', 'recall', 'audit_view_conversation'];
    for (const action of actions) {
      it(`${action} 有對話編號才可開對話`, () => {
        expect(canOpenConversation({ action, conversationId: 'c1' })).toBe(true);
        expect(canOpenConversation({ action, conversationId: '' })).toBe(false);
        expect(canOpenConversation({ action, conversationId: '   ' })).toBe(false);
      });
    }

    it('其他動作即使有對話編號也不可開對話', () => {
      expect(canOpenConversation({ action: 'settings_view', conversationId: 'c1' })).toBe(false);
    });
  });

  describe('isSelfAudit', () => {
    it('固定視為自身查詢的動作', () => {
      for (const action of ['settings_view', 'audit_search_logs', 'search_user', 'audit_view_thread']) {
        expect(isSelfAudit({ action }, false)).toBe(true);
        expect(isSelfAudit({ action }, true)).toBe(true);
      }
    });

    it('查看對話內容只在隱藏開關開啟時視為自身查詢', () => {
      expect(isSelfAudit({ action: 'audit_view_conversation' }, false)).toBe(false);
      expect(isSelfAudit({ action: 'audit_view_conversation' }, true)).toBe(true);
    });

    it('送出訊息不是自身查詢', () => {
      expect(isSelfAudit({ action: 'send' }, false)).toBe(false);
      expect(isSelfAudit({ action: 'send' }, true)).toBe(false);
    });
  });

  describe('collectLogUids', () => {
    it('去重、保留順序，並把 a,b 拆開', () => {
      const logs = [
        makeAuditLog({ actorUid: 'A', targetUid: 'B,C' }),
        makeAuditLog({ actorUid: 'B', targetUid: 'A' }),
        makeAuditLog({ actorUid: '', targetUid: '  ' }),
      ];
      expect(collectLogUids(logs)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('actionTone', () => {
    it('訊息類動作', () => {
      for (const action of ['send', 'read', 'edit', 'recall']) {
        expect(actionTone(action)).toBe('msg');
      }
    });

    it('查看對話內容為 view', () => {
      expect(actionTone('audit_view_conversation')).toBe('view');
    });

    it('其他動作歸為 admin', () => {
      expect(actionTone('settings_view')).toBe('admin');
      expect(actionTone('search_user')).toBe('admin');
    });
  });
});
