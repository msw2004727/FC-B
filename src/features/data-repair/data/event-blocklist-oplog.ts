import { writeOpLog } from '@/data/op-log';
import type { BlocklistEvent, BlocklistViewer } from './event-blocklist-model';

export const ENABLE_EVENT_BLOCKLIST_OPLOG = true;
const warn = (): void => { console.warn('[黑名單管理] Operation log unavailable'); };

export async function recordBlocklistOpLog(
  viewer: BlocklistViewer, event: BlocklistEvent, action: 'add' | 'remove', name: string,
  enabled = ENABLE_EVENT_BLOCKLIST_OPLOG,
): Promise<void> {
  if (!enabled) return;
  try {
    await writeOpLog({
      type: action === 'add' ? 'event_blocklist_add' : 'event_blocklist_remove',
      typeName: action === 'add' ? '加入活動黑名單' : '移除活動黑名單',
      content: '活動「' + (event.title || '未命名') + '」' + (action === 'add' ? '加入' : '移除') + '黑名單：' + (name || '未命名'),
      ...(event.id ? { eventId: event.id } : {}),
      actorUid: viewer.uid,
      operator: viewer.displayName || '管理員',
    }, warn);
  } catch { warn(); }
}
