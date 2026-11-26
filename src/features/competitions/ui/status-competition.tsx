// 賽事狀態入口與確認框（詳情頁主辦卡）。
// 對齊 status-access 的 canSetCompetitionStatus／statusTargetsOf；頁面用 canSetCompetitionStatus 擋顯示。
// 取消賽事要勾「我了解」＋0.6 秒防連點，比照 DeleteDialog。
// 左鈕用「返回」而不是「取消」，避免和右邊的「取消賽事」混淆。
// 成功後入口先關框，再交給頁面的 onDone 就地更新根文件。

import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Modal } from '@/ui/Modal';
import { RadioGroup } from '@/ui/RadioGroup';
import { Textarea } from '@/ui/Textarea';
import type { CpActions } from '../actions';
import type { CompetitionsT } from '../i18n';
import {
  STATUS_REASON_MAX,
  STATUS_REASON_MIN,
  statusTargetsOf,
  type StatusTarget,
} from '../status-access';
import { boundedReason } from '../data/host-write';
import { cleanLine } from '../data/names';
import { DELETE_ARM_MS, useArmed } from './delete-competition';
import { errorOf, reasonText } from './feedback';
import { AlertIcon, NextIcon } from './shell';

export interface StatusCompetitionProps {
  ct: CompetitionsT;
  cid: string;
  /** 目前狀態；只會是 published 或 postponed（頁面已用 canSetCompetitionStatus 擋）。 */
  status: 'published' | 'postponed';
  actions: Pick<CpActions, 'setCompetitionStatus'>;
  /** 成功：頁面就地更新根文件並顯示提示。reason 在 published 時是 null。 */
  onDone: (next: { status: StatusTarget; statusReason: string | null }) => void;
  /** harness 截圖用：首屏就打開確認框。 */
  previewOpen?: { choice?: StatusTarget; reason?: string; ack?: boolean; armed?: boolean; error?: string };
}

function entryKey(status: 'published' | 'postponed'): string {
  return status === 'published' ? 'statusEntry' : 'statusEntryResume';
}

function optionKey(choice: StatusTarget): string {
  if (choice === 'postponed') return 'statusPostpone';
  if (choice === 'published') return 'statusResume';
  return 'statusCancel';
}

function confirmKey(choice: StatusTarget): string {
  if (choice === 'postponed') return 'statusPostponeOk';
  if (choice === 'published') return 'statusResumeOk';
  return 'statusCancelOk';
}

export function StatusCompetitionEntry(props: StatusCompetitionProps): JSX.Element {
  const { ct, status, previewOpen } = props;
  const [open, setOpen] = useState(previewOpen != null);
  return (
    <>
      <Button variant="ghost" trailing={<NextIcon />} onClick={() => setOpen(true)}>
        {ct(entryKey(status))}
      </Button>
      {open ? (
        <StatusCompetitionDialog
          {...props}
          onClose={() => setOpen(false)}
          onDone={(next) => {
            setOpen(false);
            props.onDone(next);
          }}
        />
      ) : null}
    </>
  );
}

export function StatusCompetitionDialog(props: StatusCompetitionProps & { onClose: () => void }): JSX.Element {
  const { ct, cid, status, actions, onDone, previewOpen, onClose } = props;
  const cancelId = useId();
  const [choice, setChoice] = useState<StatusTarget | undefined>(previewOpen?.choice);
  const [reason, setReason] = useState<string>(previewOpen?.reason ?? '');
  const [ack, setAck] = useState(previewOpen?.ack === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    previewOpen?.error ? reasonText(ct, previewOpen.error) : null,
  );
  const lock = useRef(false);
  const alive = useRef(true);
  // 最後一次勾選的時間。useArmed 在「勾掉再勾回」時會晚一個畫面才變回 false，送出前再用時間戳擋一次。
  const ackAt = useRef(previewOpen?.ack ? 0 : Number.POSITIVE_INFINITY);
  const timed = useArmed(ack);
  const armed = previewOpen?.armed ?? timed;

  useEffect(() => {
    alive.current = true;
    // Modal 開啟時把焦點放在第一個可聚焦元素（右上角關閉）。這裡在它之後改放返回。
    document.getElementById(cancelId)?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, [cancelId]);

  const targets = statusTargetsOf(status);
  const options = targets.map((value) => ({ value, label: ct(optionKey(value)) }));

  function changeChoice(value: string): void {
    const next = value as StatusTarget;
    setChoice(next);
    setError(null);
    if (next !== 'cancelled') setAck(false);
  }

  async function submit(): Promise<void> {
    if (lock.current) return;
    if (!choice) return;
    if (choice === 'cancelled') {
      if (!ack || !armed) return;
      if (Date.now() - ackAt.current < DELETE_ARM_MS) return;
    }
    // 與後端 statusReasonOf（requireLine→cleanLine）同一套清理：NFKC、去不可見字元、壓空白（Opus 審 P3-1）。
    const cleaned = cleanLine(reason) ?? '';
    if (choice === 'postponed' || choice === 'cancelled') {
      const problem = boundedReason(cleaned, STATUS_REASON_MIN, STATUS_REASON_MAX);
      if (problem) {
        setError(reasonText(
          ct,
          problem,
          problem === 'FIELD_LENGTH' ? { min: STATUS_REASON_MIN, max: STATUS_REASON_MAX } : undefined,
        ));
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (choice === 'published') {
        await actions.setCompetitionStatus({ cid, status: 'published' });
      } else {
        await actions.setCompetitionStatus({ cid, status: choice, reason: cleaned });
      }
      if (alive.current) onDone({ status: choice, statusReason: choice === 'published' ? null : cleaned });
    } catch (err) {
      const info = errorOf(err);
      if (alive.current) setError(reasonText(ct, info.reason, info.params));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const showReason = choice === 'postponed' || choice === 'cancelled';
  const showCancelBlock = choice === 'cancelled';

  let submitButton: JSX.Element;
  if (choice === 'cancelled') {
    submitButton = (
      <Button
        variant="danger"
        loading={busy}
        disabled={!ack || !armed}
        data-confirm-armed={ack && armed ? 'true' : 'false'}
        onClick={() => { void submit(); }}
      >
        {ct(confirmKey(choice))}
      </Button>
    );
  } else if (choice === 'postponed' || choice === 'published') {
    submitButton = (
      <Button variant="primary" loading={busy} onClick={() => { void submit(); }}>
        {ct(confirmKey(choice))}
      </Button>
    );
  } else {
    submitButton = (
      <Button variant="primary" disabled loading={busy}>
        {ct('statusOk')}
      </Button>
    );
  }

  return (
    <Modal
      open
      size="sm"
      class="d2-panel"
      title={ct(entryKey(status))}
      busy={busy}
      onClose={onClose}
      footer={(
        <div class="cps-footer">
          <Button id={cancelId} variant="secondary" disabled={busy} onClick={onClose}>{ct('back')}</Button>
          {submitButton}
        </div>
      )}
    >
      <div class="cps-sheet-body">
        <RadioGroup
          label={ct('statusChoose')}
          value={choice}
          options={options}
          onValueChange={changeChoice}
          disabled={busy}
        />
        {showReason ? (
          <Textarea
            label={ct('statusReason')}
            hint={ct('statusReasonHint')}
            required
            value={reason}
            maxLength={STATUS_REASON_MAX}
            rows={2}
            variant="fixed"
            disabled={busy}
            onValueChange={(next) => setReason(next)}
          />
        ) : null}
        {showCancelBlock ? (
          <>
            <p class="cps-note cps-del-warn"><AlertIcon /><span>{ct('statusCancelWarn')}</span></p>
            <Checkbox
              label={ct('statusCancelAck')}
              checked={ack}
              disabled={busy}
              onCheckedChange={(next) => {
                if (next) ackAt.current = Date.now();
                setAck(next);
              }}
            />
          </>
        ) : null}
        {error ? <p class="cps-note cps-warn" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
