// 「只看我的」清單最下方的「移除我的賽事資料」（設計 §4.11，站長看預覽同意才上線）。
// 流程：灰色連結 → 底部面板說明三行（繼續／取消）→ 危險確認框 → 面板上的繼續鈕轉圈「處理中…」→ 關面板、toast。
// 一次處理全部賽事，所以只放清單、不放單一賽事頁。後端只認登入者，前端不送 uid。
// ASSUMPTION: 失敗（含限流）也關面板、用 toast 說明；要重試再點一次連結。
// ASSUMPTION: partial／waiting 而 waiting 是空的（伺服器只是還沒做完），用不帶場數的那一句，不寫「其餘 0 場」。

import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { toast } from '@/ui/Toast';
import type { CpActions } from '../actions';
import { toCpCallError, type CpDataRemovalResult } from '../data/cp-callables';
import type { CompetitionsT } from '../i18n';
import { dangerConfirm } from '../ui/danger-confirm';
import { reasonText } from '../ui/feedback';

/** 完成後的提示句。N＝waiting 裡不同賽事的場數。 */
export function removalDoneText(ct: CompetitionsT, result: CpDataRemovalResult): string {
  if (result.status === 'done') return ct('removeMineDone');
  const n = new Set((result.waiting ?? []).map((row) => row.cid)).size;
  return n > 0 ? ct('removeMineLater', { n }) : ct('removeMineLaterNoCount');
}

export function MyDataRemoval({
  ct,
  actions,
  onRemoved,
}: {
  ct: CompetitionsT;
  actions: Pick<CpActions, 'requestMyDataRemoval'>;
  /** 伺服器回成功（done／partial／waiting）後呼叫，讓清單重新讀取。 */
  onRemoved: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 同一 tick 連點兩次也只送一次（確認框開著時、處理中時都擋）。
  const lock = useRef(false);

  const run = async (): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    try {
      const ok = await dangerConfirm(ct('removeMineAsk'), { okText: ct('removeMineOk'), danger: true });
      if (!ok) return;
      setBusy(true);
      try {
        const result = await actions.requestMyDataRemoval();
        setOpen(false);
        toast.show({ message: removalDoneText(ct, result) });
        onRemoved();
      } catch (err) {
        const e = toCpCallError(err);
        setOpen(false);
        toast.show({ message: reasonText(ct, e.reason, e.params), tone: 'error' });
      } finally {
        setBusy(false);
      }
    } finally {
      lock.current = false;
    }
  };

  return (
    <>
      {/* 樣式全用既有 class（賽事樣式上限只剩個位數位元組）：置中一行沿用清單空狀態 cpl-xmsg，灰字底線連結沿用 cp3-textlink。 */}
      <div class="cpl-xmsg" data-cp-removal="">
        <button type="button" class="cp3-textlink" onClick={() => setOpen(true)}>{ct('removeMine')}</button>
      </div>
      {open ? (
        <BottomSheet
          open
          class="d2-panel"
          title={ct('removeMine')}
          busy={busy}
          busyMessage={ct('removeMineBusy')}
          onClose={() => setOpen(false)}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void run(); }}>
                {busy ? ct('removeMineBusy') : ct('removeMineContinue')}
              </Button>
            </div>
          )}
        >
          {/* 三行說明的換行寫在字串裡（cps-pre），不讓瀏覽器自己折。 */}
          <div class="cps-sheet-body" data-cp-removal-lines="">
            <p class="cps-lead cps-pre">{ct('removeMineLine1')}</p>
            <p class="cps-lead cps-pre">{ct('removeMineLine2')}</p>
            <p class="cps-lead cps-pre">{ct('removeMineLine3')}</p>
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}
