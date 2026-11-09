import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { manifest } from './index';
import { resolveCommentEventId } from './register-actions';
import { getMessageAction } from '@/core/action-registry';
import type { InboxMessageLike, MessageActionViewer } from '@/core/action-registry';

const viewer: MessageActionViewer = { uid: 'u1', role: 'user' };

function makeMessage(meta: Record<string, unknown> | null): InboxMessageLike {
  return { id: 'ecn_doc1_c1', actionType: 'event_comment', actionStatus: null, meta } as unknown as InboxMessageLike;
}

function handler() {
  const h = getMessageAction('event_comment');
  if (!h) throw new Error('event_comment handler missing');
  return h;
}

describe('event_comment 收件匣動作（前往活動）', () => {
  it('events manifest 以 messageActions.event_comment 動態載入登錄檔', async () => {
    const loader = manifest.messageActions?.event_comment;
    expect(typeof loader).toBe('function');
    const mod = (await loader!()) as { resolveCommentEventId?: unknown };
    expect(mod.resolveCommentEventId).toBe(resolveCommentEventId);
    expect(getMessageAction('event_comment')).not.toBeNull();
  });

  it('id 取 meta.eventDocId 優先，缺才用 meta.eventId', () => {
    expect(resolveCommentEventId(makeMessage({ eventDocId: 'doc1', eventId: 'ev1' }))).toBe('doc1');
    expect(resolveCommentEventId(makeMessage({ eventDocId: '', eventId: 'ev1' }))).toBe('ev1');
    expect(resolveCommentEventId(makeMessage({ eventId: 'ev1' }))).toBe('ev1');
    expect(resolveCommentEventId(makeMessage({ eventDocId: '  ', eventId: 7 }))).toBe('');
    expect(resolveCommentEventId(makeMessage(null))).toBe('');
  });

  it('canAct 不檢查權限：有活動 id 就可操作，兩者都缺就不顯示', async () => {
    expect(await handler().canAct(viewer, makeMessage({ eventDocId: 'doc1' }))).toBe(true);
    expect(await handler().canAct({ uid: null }, makeMessage({ eventId: 'ev1' }))).toBe(true);
    expect(await handler().canAct(viewer, makeMessage({ commentId: 'c1' }))).toBe(false);
    expect(await handler().canAct(viewer, makeMessage(null))).toBe(false);
  });

  it('run 導向 /events/{eventDocId}（eventDocId 優先、路徑編碼）', async () => {
    const action = handler().actions[0]!;
    expect(action.key).toBe('openEvent');
    expect(action.labelKey).toBe('inbox.actions.openEvent');

    const navigate = vi.fn();
    await action.run(makeMessage({ eventDocId: 'doc1', eventId: 'ev1' }), viewer, { navigate });
    expect(navigate).toHaveBeenLastCalledWith('/events/doc1');

    await action.run(makeMessage({ eventId: 'ev/1 a' }), viewer, { navigate });
    expect(navigate).toHaveBeenLastCalledWith('/events/ev%2F1%20a');
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('run 缺活動 id 或缺導覽能力時拋錯、不導向', async () => {
    const action = handler().actions[0]!;
    const navigate = vi.fn();
    await expect(action.run(makeMessage({}), viewer, { navigate })).rejects.toThrow();
    await expect(action.run(makeMessage({ eventDocId: 'doc1' }), viewer)).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('inbox 7 個語系都有非空的 actions.openEvent', () => {
    const dir = join(process.cwd(), 'src/features/inbox/locales');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(['en.json', 'ja.json', 'ko.json', 'th.json', 'vi.json', 'zh-CN.json', 'zh-TW.json']);
    for (const file of files) {
      const dict = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { actions?: Record<string, unknown> };
      expect(Object.keys(dict.actions ?? {}), file).toEqual(['openEvent']);
      const label = dict.actions?.openEvent;
      expect(typeof label === 'string' && label.trim().length > 0, file).toBe(true);
    }
    const zhTW = JSON.parse(readFileSync(join(dir, 'zh-TW.json'), 'utf8')) as { actions: { openEvent: string } };
    expect(zhTW.actions.openEvent).toBe('前往活動');
  });
});
