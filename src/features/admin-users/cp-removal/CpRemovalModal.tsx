// 用戶管理「賽事個資移除」面板（設計 §4.8；顧問 §3.816②）。用戶卡上的入口按了才延遲載入這支。
// 流程：選原因 → 產生試算（任何管理員）→ 看逐場摘要、不可復原項目、限制說明、確認碼期限
//       → 執行（只有 super_admin 看得到；伺服器另擋 SUPER_ADMIN_ONLY）→ 危險確認框 → 處理中 → toast。
// 外觀照用戶管理既有的編輯彈窗（A 的 .modal 一族，一般後台風格，不用前台玻璃）；版面用行內樣式，不改 A 原檔 CSS。
// uid 只放在 Callable 本文，不放網址。
// ASSUMPTION: 換原因、執行完成、DRY_RUN_STALE／DRY_RUN_REQUIRED 都清掉試算（確認碼綁原因且只能用一次）。
// ASSUMPTION: 危險確認用全站 appConfirm（danger: true）；賽事頁的 dangerConfirm 只是替它在賽事樣式裡上紅框，後台沒有那份樣式。

import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { appConfirm } from '@/ui/AppConfirm';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';
import {
  cpHostAdminRemovalDryRun,
  cpHostAdminRemovalRun,
  toCpCallError,
  type CpAdminRemovalDryRun,
  type CpAdminRemovalReason,
  type CpDataRemovalResult,
} from '@/features/competitions/data/cp-callables';

import {
  CP_REMOVAL_COPY as C,
  NOW_LABELS,
  PHASE_LABELS,
  ROLE_LABELS,
  laterDoneText,
  taipeiText,
  totalsText,
  warningTexts,
} from './copy';

export interface CpRemovalApi {
  dryRun(input: { uid: string; reasonCode: CpAdminRemovalReason }): Promise<CpAdminRemovalDryRun>;
  run(input: { uid: string; reasonCode: CpAdminRemovalReason; confirmToken: string }): Promise<CpDataRemovalResult>;
}

export const liveCpRemovalApi: CpRemovalApi = { dryRun: cpHostAdminRemovalDryRun, run: cpHostAdminRemovalRun };

export interface CpRemovalModalProps {
  uid: string;
  name: string;
  /** 只有 super_admin 看得到執行鈕。 */
  canRun: boolean;
  api?: CpRemovalApi;
  onClose: () => void;
}

const ERROR_TEXT: Readonly<Record<string, string>> = {
  DRY_RUN_STALE: C.stale,
  DRY_RUN_REQUIRED: C.required,
  SUMMARY_TOO_LARGE: C.tooLarge,
  SUPER_ADMIN_ONLY: C.superOnly,
  // 伺服器另對站長 uid 白名單（cpOwnerConfig/removal）；不在名單同樣顯示需由站長本人操作
  OWNER_ONLY: C.superOnly,
};

const ROW = 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap';
const BOX = 'border:1px solid var(--border);border-radius:var(--radius-sm);padding:.6rem .8rem;margin-top:.6rem';
const H = 'color:var(--text-primary);font-weight:700;font-size:.85rem;margin:0 0 .2rem';
const MUTED = 'color:var(--text-muted);font-size:.8rem';
const DANGER = 'color:var(--danger);font-weight:700';
// 多個項目一列排：每項不拆開（不被動斷行），放不下整項換到下一行。
const ITEMS = 'display:flex;flex-wrap:wrap;column-gap:.8rem;row-gap:.1rem';
const NOWRAP = 'white-space:nowrap';

function Items({ items, style }: { items: readonly string[]; style?: string }): JSX.Element {
  return (
    <p style={`${ITEMS};margin:.2rem 0 0${style ? `;${style}` : ''}`}>
      {items.map((item) => <span key={item} style={NOWRAP}>{item}</span>)}
    </p>
  );
}

function Spinner(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" aria-hidden="true" style="animation:spin .8s linear infinite;vertical-align:-2px;margin-right:.35rem">
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  );
}

function nowItems(now: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [key, label] of Object.entries(NOW_LABELS)) {
    const n = now[key];
    if (typeof n === 'number' && n > 0) out.push(`${label} ${n}`);
  }
  return out;
}

function SummaryView({ summary }: { summary: CpAdminRemovalDryRun }): JSX.Element {
  const warnings = warningTexts(summary.warnings ?? []);
  return (
    <div data-cp-removal-summary="">
      {summary.competitions.length === 0 ? <p style={`${MUTED};margin:.6rem 0 0`}>{C.noComps}</p> : null}
      {summary.competitions.map((comp) => {
        const items = nowItems(comp.now);
        const roles = comp.roles.map((role) => ROLE_LABELS[role]).filter(Boolean).join('、');
        return (
          <div key={comp.cid} style={BOX} data-cid={comp.cid}>
            <p style={`${H};overflow-wrap:anywhere`}>{comp.name}</p>
            <p style={`${MUTED};margin:0`}>{[roles, PHASE_LABELS[comp.phase]].filter(Boolean).join('・')}</p>
            {items.length > 0 ? <Items items={items} style="color:var(--text-primary)" /> : null}
            {comp.later?.until ? (
              <p style="margin:.2rem 0 0" data-cp-later="">{`${C.later}：${comp.later.until}${C.laterSuffix}`}</p>
            ) : null}
          </div>
        );
      })}
      <p style={`${H};margin-top:.8rem`} data-cp-totals="">{`${C.total}：${totalsText(summary.totals)}`}</p>
      {summary.irreversible.length > 0 ? (
        <div data-cp-irreversible="">
          <Items items={[`${C.irreversible}：`, ...summary.irreversible]} style={`${DANGER};column-gap:.5rem`} />
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div style={`${BOX};border-color:var(--danger)`} data-cp-warnings="">
          <p style={`${H};color:var(--danger)`}>{C.warnings}</p>
          {warnings.map((text) => <p key={text} style="margin:0">{text}</p>)}
        </div>
      ) : null}
      {summary.limitations && summary.limitations.length > 0 ? (
        <div style={BOX} data-cp-limitations="">
          <p style={H}>{C.limitations}</p>
          {summary.limitations.map((text) => <p key={text} style="margin:0 0 .2rem">{text}</p>)}
        </div>
      ) : null}
      <p style={`${MUTED};margin:.6rem 0 0`} data-cp-expires="">{`${C.expires} ${taipeiText(summary.expiresAt)}`}</p>
    </div>
  );
}

export function CpRemovalModal({ uid, name, canRun, api = liveCpRemovalApi, onClose }: CpRemovalModalProps): JSX.Element {
  const [reason, setReason] = useState<CpAdminRemovalReason>('subject_request');
  const [summary, setSummary] = useState<CpAdminRemovalDryRun | null>(null);
  const [busy, setBusy] = useState<'dry' | 'run' | null>(null);
  const lock = useRef(false);
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const unlock = lockBody(document.body);
    const requestClose = (): boolean => {
      if (latest.current.busy) {
        toast.show({ message: C.runBusy, tone: 'info' });
        return true;
      }
      latest.current.onClose();
      return true;
    };
    const releaseBack = pushOverlay(requestClose);
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener('keydown', handleKey, true);
    closeButton.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      releaseBack();
      unlock();
    };
  }, []);

  const requestClose = (): void => {
    if (busy) {
      toast.show({ message: C.runBusy, tone: 'info' });
      return;
    }
    onClose();
  };

  const showError = (err: unknown): string => {
    const e = toCpCallError(err);
    toast.show({ message: ERROR_TEXT[e.reason] ?? C.failed, tone: 'error' });
    return e.reason;
  };

  const runDry = async (): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setBusy('dry');
    try {
      setSummary(await api.dryRun({ uid, reasonCode: reason }));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      lock.current = false;
    }
  };

  const runRemoval = async (): Promise<void> => {
    if (lock.current || !summary) return;
    lock.current = true;
    try {
      const ok = await appConfirm(C.runAsk, { okText: C.runOk, danger: true });
      if (!ok) return;
      setBusy('run');
      try {
        const result = await api.run({ uid, reasonCode: reason, confirmToken: summary.confirmToken });
        setSummary(null);
        const n = new Set((result.waiting ?? []).map((row) => row.cid)).size;
        toast.show({ message: result.status === 'done' ? C.done : laterDoneText(n), tone: 'success' });
      } catch (err) {
        const code = showError(err);
        if (code === 'DRY_RUN_STALE' || code === 'DRY_RUN_REQUIRED') setSummary(null);
      } finally {
        setBusy(null);
      }
    } finally {
      lock.current = false;
    }
  };

  const blocked = (summary?.warnings ?? []).includes('SUMMARY_TRUNCATED');

  return createPortal(
    <div class="legacy-ui">
      <div class="modal-overlay open" aria-hidden="true" onClick={requestClose} />
      <div class="modal open" id="cp-removal-modal" role="dialog" aria-modal="true" aria-labelledby="cp-removal-title">
        <div class="modal-header">
          <h3 id="cp-removal-title">{C.title}</h3>
          <button ref={closeButton} type="button" class="modal-close" aria-label={C.close} onClick={requestClose}>✕</button>
        </div>
        <div class="modal-body">
          <p style={`${ROW};margin:0`}>
            <span style={MUTED}>{C.member}</span>
            <span style="color:var(--text-primary);font-weight:700;overflow-wrap:anywhere" data-cp-member="">{name || '—'}</span>
          </p>
          <div class="ce-form" style="margin-top:.6rem">
            <div class="ce-row">
              <label for="cp-removal-reason">{C.reason}</label>
              <select
                id="cp-removal-reason"
                value={reason}
                disabled={busy !== null}
                onChange={(event) => {
                  setReason(event.currentTarget.value as CpAdminRemovalReason);
                  setSummary(null);
                }}
              >
                <option value="subject_request">{C.reasonSubject}</option>
                <option value="account_deleted">{C.reasonAccount}</option>
              </select>
            </div>
          </div>
          {summary ? <SummaryView summary={summary} /> : null}
          {summary && !canRun ? <p style={`${DANGER};margin:.6rem 0 0`} data-cp-admin-only="">{C.adminOnly}</p> : null}
        </div>
        <div class="modal-actions">
          <button type="button" class="outline-btn" style="white-space:nowrap" disabled={busy !== null} onClick={() => { void runDry(); }}>
            {busy === 'dry' ? <><Spinner />{C.dryRunBusy}</> : C.dryRun}
          </button>
          {summary && canRun ? (
            <button
              type="button"
              class="danger-btn"
              style="white-space:nowrap"
              disabled={busy !== null || blocked}
              aria-busy={busy === 'run' || undefined}
              data-cp-run=""
              onClick={() => { void runRemoval(); }}
            >
              {busy === 'run' ? <><Spinner />{C.runBusy}</> : C.run}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
