// 刪除賽事：危險鈕＋確認框。顯示與否由頁面用 canDeleteCompetition（delete-access.ts）決定。
// 確認框：寫出賽事名稱、已有幾隊報名、全部刪除無法復原；先勾「我了解刪除後無法復原」再等 0.6 秒才可按；
// 取消在左、刪除在右，打開時焦點在取消。
// 刪到一半失敗（後端已寫 hidden＋deletingAt，host.ts 516）：重讀根文件，有 deletingAt 就交給頁面改成「繼續刪除」；
// 讀到已不存在（或伺服器回 COMPETITION_NOT_FOUND）當作已刪完。後端重跑同一支 delete 即續刪（host.ts 503、507～509）。
// 0.6 秒防連點與左右順序比照記分頁 ConfirmFooter（cp4-a1 live/score-states.tsx，尚未合併進這個基底）；合併後可改用那份。

import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Modal } from '@/ui/Modal';
import type { CpActions } from '../actions';
import type { CompetitionDoc } from '../data/types';
import type { CompetitionsT } from '../i18n';
import { errorOf, reasonText } from './feedback';

export const DELETE_ARM_MS = 600;

/** 伺服器在封鎖前就拒絕：賽事沒有被動到，不必重讀。 */
const REJECTED_BEFORE_LOCK: ReadonlySet<string> = new Set([
  'SIGN_IN_REQUIRED',
  'INTERNAL_PERIOD',
  'INTERNAL_COMPETITION',
  'NOT_PRIMARY_HOST',
  'COMPETITION_HIDDEN',
  'DELETE_AFTER_START',
  'BAD_ID',
  'UNKNOWN_FIELD',
]);

/** on 變成 true 後 ms 毫秒才回 true；on 變回 false 立刻重來。 */
export function useArmed(on: boolean, ms: number = DELETE_ARM_MS): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    if (!on) return undefined;
    const id = window.setTimeout(() => setArmed(true), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return armed;
}

/**
 * core/overlay-back 寫進 history.state 的鍵名（它沒有匯出；為了首頁入口預算不在那邊加匯出，顧問裁定）。
 * 鍵名耦合由 ui/delete-competition.test.ts「overlay-back 的 history.state 鍵名」鎖住：overlay-back 改鍵名，那條測試會紅。
 */
export const OVERLAY_STATE_KEY = '__overlay';

/**
 * 等確認框那筆同網址歷史紀錄退掉（overlay-back：彈窗卸載後下一刻 history.back）。
 * 先退掉再換頁，換頁的「取代」才會蓋掉賽事詳情那筆，返回鍵不會回到已刪除的賽事。最多等 maxMs。
 */
export async function waitOverlayReleased(maxMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const state: unknown = history.state;
    if (!(state && typeof state === 'object' && OVERLAY_STATE_KEY in state)) return;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/** 報隊數（pending＋approved）。組別的 entryCount 由伺服器維護，不受報隊清單上限影響。 */
export function teamCountOf(divisions: ReadonlyArray<{ entryCount: number }>): number {
  return divisions.reduce((sum, division) => sum + Math.max(0, division.entryCount), 0);
}

export interface DeleteCompetitionProps {
  ct: CompetitionsT;
  cid: string;
  name: string;
  /** 已知的報隊數。null＝手上沒有組別，打開確認框時用 loadTeams 讀一次。 */
  teams: number | null;
  loadTeams: () => Promise<number>;
  /** 根文件 deletingAt 有值：上次刪到一半。 */
  resume: boolean;
  actions: Pick<CpActions, 'deleteCompetition'>;
  /** 重讀根文件。null＝已不存在。 */
  reload: () => Promise<CompetitionDoc | null>;
  onDeleted: () => void;
  /** 重讀到 deletingAt 有值：頁面換上新文件，改顯示續刪。 */
  onStuck: (doc: CompetitionDoc) => void;
  /** harness 截圖用：首屏就打開確認框，ack 為已勾。 */
  previewOpen?: { ack: boolean; armed?: boolean; error?: string };
}

export function DeleteCompetition(props: DeleteCompetitionProps): JSX.Element {
  const { ct, resume, previewOpen } = props;
  const [open, setOpen] = useState(previewOpen != null);
  // 一律放在主辦區最下方、與其他按鈕拉開距離。續刪時只換字，位置不變（換位置會重掛、關掉正在顯示錯誤的確認框）。
  return (
    <>
      <div class="cps-actions" style="margin-top:var(--space-8)">
        <Button variant="danger" onClick={() => setOpen(true)}>{resume ? ct('deleteResume') : ct('deleteComp')}</Button>
      </div>
      {open ? (
        <DeleteDialog
          {...props}
          onClose={() => setOpen(false)}
          onDeleted={async () => {
            setOpen(false);
            // 先等確認框那筆同網址歷史紀錄退掉，頁面的「取代」才會蓋到賽事詳情那筆，返回不會回到已刪除的賽事。
            await waitOverlayReleased();
            props.onDeleted();
          }}
        />
      ) : null}
    </>
  );
}

function DeleteDialog({
  ct,
  cid,
  name,
  teams,
  loadTeams,
  resume,
  actions,
  reload,
  onDeleted,
  onStuck,
  previewOpen,
  onClose,
}: DeleteCompetitionProps & { onClose: () => void }): JSX.Element {
  const cancelId = useId();
  const [ack, setAck] = useState(previewOpen?.ack === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(
    previewOpen?.error ? { reason: previewOpen.error } : null,
  );
  const [count, setCount] = useState<number | null>(teams);
  const timed = useArmed(ack);
  const armed = previewOpen?.armed ?? timed;
  const lock = useRef(false);
  const alive = useRef(true);
  // 最後一次勾選的時間。useArmed 在「勾掉再勾回」時會晚一個畫面才變回 false，送出前再用時間戳擋一次。
  const ackAt = useRef(previewOpen?.ack ? 0 : Number.POSITIVE_INFINITY);

  useEffect(() => {
    alive.current = true;
    // Modal 開啟時把焦點放在第一個可聚焦元素（右上角關閉）。這裡在它之後改放取消。
    document.getElementById(cancelId)?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, [cancelId]);

  useEffect(() => {
    if (teams != null) return;
    void (async () => {
      try {
        const n = await loadTeams();
        if (alive.current) setCount(n);
      } catch {
        // 讀不到就不寫數字，刪除照常可按。
      }
    })();
    // 只在打開時讀一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm(): Promise<void> {
    if (lock.current || !ack || !armed) return;
    if (Date.now() - ackAt.current < DELETE_ARM_MS) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await actions.deleteCompetition({ cid });
      onDeleted();
      return;
    } catch (err) {
      const failure = errorOf(err);
      if (failure.reason === 'COMPETITION_NOT_FOUND') {
        onDeleted();
        return;
      }
      if (!REJECTED_BEFORE_LOCK.has(failure.reason)) {
        // 可能已封鎖（deletingAt）或其實已刪完（連線逾時）：重讀根文件決定畫面。
        let doc: CompetitionDoc | null | undefined;
        try {
          doc = await reload();
        } catch {
          doc = undefined;
        }
        if (doc === null) {
          onDeleted();
          return;
        }
        if (doc && doc.deletingAt != null) onStuck(doc);
      }
      if (alive.current) setError(failure);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      class="d2-panel"
      title={resume ? ct('deleteResume') : ct('deleteComp')}
      busy={busy}
      onClose={onClose}
      footer={(
        <div class="cps-footer">
          <Button id={cancelId} variant="secondary" disabled={busy} onClick={onClose}>{ct('cancel')}</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!ack || !armed}
            data-delete-armed={ack && armed ? 'true' : 'false'}
            onClick={() => { void confirm(); }}
          >
            {resume ? ct('deleteResume') : ct('deleteComp')}
          </Button>
        </div>
      )}
    >
      <div class="cps-sheet-body">
        <div>
          {/* 顧問 §3.459：長賽事名稱在 360 寬被切、沒有省略號。只在這個框加 cps-del-name（最多兩行、超過才省略），不動共用的 .cps-h。 */}
          <p class="cps-h cps-del-name">{name}</p>
          <p class="cps-note cps-nowrap">{ct('deleteTeams', { n: count == null ? '…' : count })}</p>
        </div>
        {/* 顧問 §3.459：360 寬剛好 324＝324，拿掉 cps-nowrap，讓它可以在標點處換行。 */}
        <p class="cps-note cps-warn cps-del-warn">{ct('deleteWarn')}</p>
        <Checkbox
          label={ct('deleteAck')}
          checked={ack}
          disabled={busy}
          onCheckedChange={(next) => {
            if (next) ackAt.current = Date.now();
            setAck(next);
          }}
        />
        {/* 文案在分號處帶換行（360 寬放不下一行時不拆字）；pre-line 只用在這裡，共用的 CpError 不動。 */}
        {error ? (
          <p class="cps-note cps-warn" role="alert" style="white-space:pre-line">{reasonText(ct, error.reason, error.params)}</p>
        ) : null}
      </div>
    </Modal>
  );
}
