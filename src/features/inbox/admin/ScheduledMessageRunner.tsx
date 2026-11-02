/**
 * 全站排程信件執行器（站長 2026-11-02 Q3：管理員開著新站時，每分鐘檢查到點就送）。
 * 對應 A `app.js` 開機後立即與每 60 秒呼叫 `_processScheduledMessages`。
 * 只在 canRunScheduledMessages（admin／super_admin 且持 admin.messages.entry）時啟動；離開或身分變了就停。
 * 由 PmDialogHost（登入後全站常駐）以 lazy 載入，非管理員不下載本檔。
 */
import { useEffect } from 'preact/hooks';

import { useViewer } from '@/features/profile/data/viewer';

import { canRunScheduledMessages } from './data/admin-message-model';
import { SCHEDULE_CHECK_INTERVAL_MS, processScheduledMessages } from './data/scheduled-runner';

export default function ScheduledMessageRunner(): null {
  const viewer = useViewer();
  const enabled = canRunScheduledMessages(viewer);
  const uid = viewer.uid;

  useEffect(() => {
    if (!enabled || !uid) return undefined;
    const run = (): void => {
      processScheduledMessages({ processorId: uid, senderUid: uid }).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[Schedule] run failed:', err);
      });
    };
    run();
    const timer = setInterval(run, SCHEDULE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, uid]);

  return null;
}
