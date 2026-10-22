/**
 * 活動生命週期操作（取消／重開／重新上架）的畫面流程。
 *
 * 照 A `cancelMyActivity`／`reopenMyActivity`／`relistMyActivity` 的畫面流程：
 * 課程連結 → 權限 →（重開／上架）時間已過提示 → 確認框 → 寫入 → 重新整理列表 → 成功提示。
 *
 * 從 `MyActivitiesPage#handleLifecycle` 原樣抽出（M-122 前置，卡 2Y）。
 */

import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import type { ViewerView } from '@/features/profile/data/viewer';
import { operateContextFromViewer } from '../../data/event-create-context';
import {
  EventLifecycleError,
  cancelEvent,
  isCourseLinkedLifecycleLocked,
  isEventStartPassed,
  relistEvent,
  reopenEvent,
} from '../../data/event-lifecycle';
import {
  canCancelOwnActivity,
  canReopenOrRelistActivity,
} from '../../data/operate-permissions';
import type { EventDoc } from '../../data/types';

export type LifecycleKind = 'cancel' | 'reopen' | 'relist';

export interface LifecycleMessage {
  confirm: string;
  done: string;
  fail: string;
  startPassed: string;
}

export const LIFECYCLE_MESSAGES: Readonly<
  Record<LifecycleKind, LifecycleMessage>
> = {
  cancel: {
    confirm: '確定要取消此活動？',
    done: '活動已取消',
    fail: '取消失敗，請重試',
    startPassed: '',
  },
  reopen: {
    confirm: '確定要重新開放此活動？',
    done: '活動已重新開放',
    fail: '重新開放失敗，請重試',
    startPassed: '活動時間已過，請先編輯活動並更新時間後再重新開放。',
  },
  relist: {
    confirm: '確定要重新上架此活動？\n報名名單與候補名單將會保留。',
    done: '活動已重新上架',
    fail: '重新上架失敗，請重試',
    startPassed: '活動時間已過，請先編輯活動並更新時間後再上架。',
  },
};

export interface LifecycleActionDeps {
  viewer: ViewerView;
  operateCtx: ReturnType<typeof operateContextFromViewer>;
  busy: Set<string>;
  onDone(): void;
}

function eventDocIdOf(e: EventDoc): string {
  return String(e._docId ?? e.docId ?? e.id ?? '');
}

/**
 * 原樣搬自 MyActivitiesPage#handleLifecycle。
 * 回傳是否確實寫入成功。
 */
export async function runEventLifecycleAction(
  kind: LifecycleKind,
  event: EventDoc,
  deps: LifecycleActionDeps,
): Promise<boolean> {
  const docId = eventDocIdOf(event);
  if (!docId || deps.busy.has(docId)) return false;
  const msgs = LIFECYCLE_MESSAGES[kind];
  if (isCourseLinkedLifecycleLocked(event)) {
    toast.show({
      message:
        '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
      tone: 'error',
    });
    return false;
  }
  const allowed =
    kind === 'cancel'
      ? canCancelOwnActivity(deps.operateCtx, event)
      : canReopenOrRelistActivity(deps.operateCtx, event);
  if (!allowed) {
    toast.show({ message: '您只能管理自己的活動', tone: 'error' });
    return false;
  }
  if (kind !== 'cancel' && isEventStartPassed(event)) {
    await appConfirm(msgs.startPassed);
    return false;
  }
  deps.busy.add(docId);
  try {
    if (!(await appConfirm(msgs.confirm))) return false;
    const input = { event, eventDocId: docId, viewer: deps.viewer };
    if (kind === 'cancel') await cancelEvent(input);
    else if (kind === 'reopen') await reopenEvent(input);
    else await relistEvent(input);
    deps.onDone();
    toast.show({ message: msgs.done, tone: 'success' });
    return true;
  } catch (err: unknown) {
    if (err instanceof EventLifecycleError && err.code === 'COURSE_LINKED') {
      toast.show({
        message:
          '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
        tone: 'error',
      });
    } else if (err instanceof EventLifecycleError && err.code === 'NOT_ALLOWED') {
      toast.show({ message: '您只能管理自己的活動', tone: 'error' });
    } else if (err instanceof EventLifecycleError && err.code === 'START_PASSED') {
      await appConfirm(msgs.startPassed);
    } else {
      toast.show({ message: msgs.fail, tone: 'error' });
    }
    return false;
  } finally {
    deps.busy.delete(docId);
  }
}
