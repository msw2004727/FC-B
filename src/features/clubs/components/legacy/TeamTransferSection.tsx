/**
 * T-090h：俱樂部設定彈窗內「轉移經理」區塊（刪除鈕上方）。
 *
 * - 是否顯示由父層決定（自建俱樂部＋擁有者本人，同刪除鈕判斷）；本元件只負責選人、兩步確認與呼叫 Callable。
 * - requestId：開確認視窗時若沒有同一目標的 requestId 才產生；失敗重送沿用，成功、換人或伺服器回
 *   TRANSFER_REQUEST_ID_CONFLICT 才清掉。
 * - 錯誤只顯示對照表文案，不露原始錯誤。
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import {
  createTransferRequestId,
  resolveTransferTeamId,
  teamTransferErrorKey,
  transferUserTeamViaCallable,
  type TransferCandidate,
} from '../../data/team-transfer';
import { extractCallableReason } from '../../data/user-team-errors';
import type { TeamDoc } from '../../data/types';

export interface TeamTransferSectionProps {
  team: TeamDoc;
  /** 目前登入者（舊經理）UID；成功後從列表快取的領隊／教練名單移除。 */
  viewerUid?: string | null;
  /** null＝成員名單載入中。 */
  candidates: readonly TransferCandidate[] | null;
  /** 成員名單讀取失敗：顯示載入失敗，而不是「沒有可轉移的成員」。 */
  loadFailed?: boolean;
  /** 其他動作（例如刪除）進行中時停用。 */
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** 轉移成功（已顯示 toast）後呼叫；父層負責關閉彈窗與重讀。 */
  onTransferred: () => void | Promise<void>;
}

export function TeamTransferSection(props: TeamTransferSectionProps): JSX.Element {
  const t = useT();
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const list = props.candidates ?? [];
  const target = list.find((candidate) => candidate.uid === selected) ?? null;
  const unnamed = t('clubs.transfer.unnamed');
  // 載入失敗沿用既有 clubs.loadError（七語皆有）。
  const placeholder = props.loadFailed === true
    ? t('clubs.loadError')
    : props.candidates === null
      ? t('clubs.transfer.loading')
      : list.length === 0
        ? t('clubs.transfer.empty')
        : t('clubs.transfer.placeholder');

  function setBusyState(next: boolean): void {
    setBusy(next);
    latest.current.onBusyChange?.(next);
  }

  async function handleTransfer(): Promise<void> {
    if (lock.current || latest.current.disabled || !target) return;
    const teamId = resolveTransferTeamId(latest.current.team);
    if (!teamId) return;
    lock.current = true;
    setBusyState(true);
    const name = target.name || unnamed;
    try {
      const key = `${teamId}\n${target.uid}`;
      if (pendingRequest.current?.key !== key) {
        pendingRequest.current = { key, id: createTransferRequestId() };
      }
      const requestId = pendingRequest.current.id;
      if (!(await appConfirm(t('clubs.transfer.confirm', { name })))) return;
      if (!alive.current) return;
      if (!(await appConfirm(t('clubs.transfer.confirmFinal')))) return;
      if (!alive.current) return;

      await transferUserTeamViaCallable({
        teamId,
        newOwnerUid: target.uid,
        requestId,
        callerUid: latest.current.viewerUid ?? null,
        newOwnerName: target.name,
      });
      pendingRequest.current = null;
      toast.show({ message: t('clubs.transfer.success', { name }), tone: 'success' });
      try {
        await latest.current.onTransferred();
      } catch (error) {
        // 轉移已完成；父層重讀失敗不可回報為轉移失敗。
        console.error('[TeamTransferSection] onTransferred', error);
      }
    } catch (error) {
      if (extractCallableReason(error) === 'TRANSFER_REQUEST_ID_CONFLICT') pendingRequest.current = null;
      console.error('[TeamTransferSection]', extractCallableReason(error) || 'unknown');
      // 審查 P3-4：Callable 進行中設定視窗被關閉，失敗仍要提示（toast 不依附彈窗）。
      toast.show({ message: t(teamTransferErrorKey(error)), tone: 'error' });
    } finally {
      lock.current = false;
      if (alive.current) setBusyState(false);
    }
  }

  const title = t('clubs.transfer.title');
  const controlsDisabled = busy || props.disabled === true;

  return (
    <div class="td-settings-group td-transfer-group">
      <div class="td-settings-title">{title}</div>
      <div class="td-settings-row td-transfer-row">
        <select
          class="td-transfer-select"
          aria-label={t('clubs.transfer.select')}
          value={target ? target.uid : ''}
          disabled={controlsDisabled || list.length === 0}
          onChange={(event) => setSelected(event.currentTarget.value)}
        >
          <option value="" disabled>{placeholder}</option>
          {list.map((candidate) => (
            <option key={candidate.uid} value={candidate.uid}>
              {candidate.name || unnamed}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="outline-btn td-transfer-btn"
          disabled={controlsDisabled || !target}
          onClick={() => { void handleTransfer(); }}
        >
          {busy ? t('clubs.transfer.busy') : title}
        </button>
      </div>
    </div>
  );
}
