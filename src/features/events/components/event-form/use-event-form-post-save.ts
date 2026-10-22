import { createElement, Fragment, type ComponentChildren } from 'preact';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { EventFormSavedResult } from '../EventFormModal';

interface PostSaveInput {
  viewer: ViewerView;
  close(): void;
  refresh(): void | Promise<void>;
}

const cancellations = new Set<() => void>();

// 照 A _isEventFormPostSaveGenerationCurrent：新表單使舊分享流程失效。
export function invalidateEventFormPostSave(): void {
  for (const cancel of [...cancellations]) cancel();
}

export function useEventFormSession(open: boolean): void {
  useLayoutEffect(() => {
    if (open) invalidateEventFormPostSave();
  }, [open]);
}

export function useEventFormPostSave(
  input: PostSaveInput,
): (result: EventFormSavedResult) => void {
  const lt = useLegacyT();
  const latest = useRef(input);
  latest.current = input;
  const alive = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useLayoutEffect(() => {
    alive.current = true;
    cancellations.add(cancel);
    return () => {
      alive.current = false;
      cancellations.delete(cancel);
      cancel();
    };
  }, [cancel]);

  useLayoutEffect(() => {
    cancel();
  }, [input.viewer.uid, cancel]);

  return useCallback((result: EventFormSavedResult): void => {
    if (!alive.current) return;
    invalidateEventFormPostSave();
    const saved = { ...result };
    const snapshot = latest.current;
    const uid = snapshot.viewer.uid;
    const run = new AbortController();
    controller.current = run;
    const current = (): boolean =>
      alive.current
      && !run.signal.aborted
      && latest.current.viewer.uid === uid;

    // 照 A handleCreateEvent：關表單與成功提示先完成。
    // PM 修正：關表單可能讓本 hook 所在元件卸載（詳情頁編輯），提示／刷新／日誌／經驗值照 A 一律執行，
    // 只有 500ms 後的分享詢問才檢查 current()。
    snapshot.close();

    const { title, count, eventId, mode } = saved;
    const message = mode === 'edit'
      ? lt('活動「{title}」已更新！', '活動「{title}」已更新！', { title })
      : count > 1
        ? lt('已建立 {count} 場「{title}」活動！', '已建立 {count} 場「{title}」活動！', { title, count })
        : lt('活動「{title}」已建立！', '活動「{title}」已建立！', { title });
    toast.show({ message });

    // 照 A renderActivityList；同步例外與非同步拒絕都獨立隔離。
    try {
      Promise.resolve(snapshot.refresh()).catch(() => undefined);
    } catch {
      // 刷新失敗不影響已完成的儲存。
    }

    // 照 A _writeOpLog；不得把 op-log 的 Firestore 靜態依賴拉進首屏。
    if (uid) {
      (async () => {
        try {
          const { writeOpLog } = await import('@/data/op-log');
          // ASSUMPTION: 附件未提供角色中文名稱 helper，無顯示名稱時沿用「系統」。
          const operator = snapshot.viewer.displayName?.trim() || '系統';
          await writeOpLog({
            type: mode === 'edit' ? 'event_edit' : 'event_create',
            typeName: mode === 'edit' ? '編輯活動' : '建立活動',
            content: mode === 'edit' ? `編輯「${title}」` : `建立「${title}」`,
            ...(mode === 'edit' ? { eventId } : {}),
            actorUid: uid,
            operator,
          });
        } catch {
          // 照 A：非關鍵日誌失敗不阻擋刷新與分享。
        }
      })();
    }

    if (mode !== 'create') return;

    if (uid) {
      (async () => {
        try {
          const [{ doc, getDoc }, { getFirebase }, { callFn }] = await Promise.all([
            import('firebase/firestore'),
            import('@/data/firebase'),
            import('@/data/callables'),
          ]);
          const { db } = await getFirebase();
          const snap = await getDoc(doc(db, 'siteConfig', 'autoExpRules'));
          if (!snap.exists()) return;
          const data = snap.data() as Record<string, unknown>;
          const raw = data['host_activity'];
          const amount = typeof raw === 'number' && Number.isFinite(raw)
            ? Math.floor(raw)
            : 0;
          if (amount <= 0) return;
          // 照 A _grantAutoExp 與 grantLineBindingExp。
          await callFn('adjustExp', {
            mode: 'auto',
            targets: [uid],
            amount,
            reason: `自動：主辦活動（${title}）`,
            operatorLabel: '系統',
            requestId: `autoexp_${uid}_host_activity_${Date.now()}`,
            ruleKey: 'host_activity',
          });
        } catch {
          // 經驗值與日誌各自隔離，不互相阻擋。
        }
      })();
    }

    if (!uid || !eventId) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!current()) return;

      (async () => {
        try {
          const confirmed = await appConfirm(
            lt('活動已建立！要分享嗎？', '活動已建立！要分享嗎？'),
          );
          if (!current() || !confirmed) return;

          const [{ loadEventDetail }, { shareEvent }] = await Promise.all([
            import('../../data/event-detail'),
            import('../../data/event-share'),
          ]);
          if (!current()) return;
          const detail = await loadEventDetail(eventId);
          if (!current() || !detail) return;

          // ASSUMPTION: 無已載入的熱度與報名快照，使用 shareEvent 的選用欄位預設值。
          await shareEvent({ ...detail.event, id: eventId }, {
            loggedIn: true,
            signal: run.signal,
            showToast: (text) => {
              if (current()) toast.show({ message: lt(text, text) });
            },
          });
        } catch {
          // 照 A _promptShareAfterCreate：失敗不影響建立結果。
        }
      })();
    }, 500);
  }, [lt]);
}

interface BoundaryProps extends PostSaveInput {
  children: (onSaved: (result: EventFormSavedResult) => void) => ComponentChildren;
}

// 照 A 編輯表單 session；附件只提供條件渲染區，以子元件維持 hook 呼叫順序。
export function EventFormPostSaveBoundary(props: BoundaryProps) {
  useEventFormSession(true);
  const onSaved = useEventFormPostSave(props);
  return createElement(Fragment, null, props.children(onSaved));
}
