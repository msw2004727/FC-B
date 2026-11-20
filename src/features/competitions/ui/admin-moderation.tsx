// 管理員下架／恢復（K12 moderate）與檢舉紀錄（K12 reviewReport）。後台性質：一般平面卡片，不用液態玻璃。
// 只有管理員會渲染這個區塊；檢舉清單按下「檢舉紀錄」才讀（limit 50），其他人 0 讀。
// 檢舉文件的 reporterUid 在 repo 就不讀出來，這裡也沒有任何欄位放它。原因、說明一律 JSX 文字。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { appConfirm } from '@/ui/AppConfirm';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { Textarea } from '@/ui/Textarea';
import { toast } from '@/ui/Toast';
import { missingAction, type CpActions } from '../actions';
import type { CompetitionsRepo } from '../data/cp-repo';
import { boundedReason } from '../data/host-write';
import type { ReportDoc, ReportReason, ReportReviewStatus } from '../data/types';
import { formatTaipeiShort } from '../format';
import type { CompetitionsT } from '../i18n';
import { errorOf, reasonText } from './feedback';

export const MODERATE_REASON_MIN = 2;
export const MODERATE_REASON_MAX = 200;

/** 主辦、共同主辦、管理員打開已下架賽事時的頂部提示。 */
export function HiddenNotice({ ct, reason }: { ct: CompetitionsT; reason: string | null | undefined }): JSX.Element {
  const text = reason && reason.trim()
    ? ct('hiddenByAdmin', { reason: reason.trim() })
    : ct('hiddenByAdminNoReason');
  return <p class="cpa-hidden" role="status">{text}</p>;
}

export function reportReasonLabel(ct: CompetitionsT, reason: ReportReason): string {
  if (reason === 'impersonation') return ct('reportImpersonation');
  if (reason === 'fake') return ct('reportFake');
  if (reason === 'inappropriate') return ct('reportInappropriate');
  if (reason === 'privacy') return ct('reportPrivacy');
  return ct('reportOther');
}

function statusBadge(ct: CompetitionsT, status: ReportReviewStatus): { label: string; tone: 'warning' | 'success' | 'neutral' } {
  if (status === 'resolved') return { label: ct('reportStatusResolved'), tone: 'success' };
  if (status === 'dismissed') return { label: ct('reportStatusDismissed'), tone: 'neutral' };
  return { label: ct('reportStatusOpen'), tone: 'warning' };
}

export function ModerateDialog({
  ct,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  ct: CompetitionsT;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title={ct('moderateHideTitle')}
      busy={busy}
      error={error ?? undefined}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={(
        <div class="cps-footer">
          <Button variant="secondary" disabled={busy} onClick={onClose}>{ct('cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={busy} onClick={() => onSubmit(reason)}>{ct('moderateHide')}</Button>
        </div>
      )}
    >
      <Textarea
        label={ct('moderateReason')}
        required
        value={reason}
        maxLength={MODERATE_REASON_MAX}
        rows={3}
        variant="fixed"
        onValueChange={setReason}
      />
    </Modal>
  );
}

export interface AdminPanelProps {
  ct: CompetitionsT;
  cid: string;
  hidden: boolean;
  actions: CpActions;
  repo: CompetitionsRepo;
  /** 下架對話框由頁面控制（右上選單也能打開）。 */
  hideOpen: boolean;
  setHideOpen: (open: boolean) => void;
  onHiddenChange: (hidden: boolean, reason: string | null) => void;
  /** harness 用：首屏就展開檢舉紀錄。 */
  initialReportsOpen?: boolean;
}

export function AdminPanel(props: AdminPanelProps): JSX.Element {
  const { ct, cid } = props;
  const [busy, setBusy] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reports, setReports] = useState<ReportDoc[] | null>(null);
  const [reportsFailed, setReportsFailed] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const loading = useRef(false);
  const autoOpened = useRef(false);

  async function loadReports(): Promise<void> {
    if (loading.current) return;
    loading.current = true;
    setReportsFailed(false);
    try {
      setReports(await props.repo.listReports(cid));
    } catch {
      setReportsFailed(true);
    } finally {
      loading.current = false;
    }
  }

  function toggleReports(): void {
    const next = !reportsOpen;
    setReportsOpen(next);
    if (next && reports == null) void loadReports();
  }

  useEffect(() => {
    if (!props.initialReportsOpen || autoOpened.current) return;
    autoOpened.current = true;
    toggleReports();
    // 只在首屏跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hide(reason: string): Promise<void> {
    const problem = boundedReason(reason, MODERATE_REASON_MIN, MODERATE_REASON_MAX);
    if (problem) {
      setHideError(reasonText(ct, problem, problem === 'FIELD_LENGTH' ? { min: MODERATE_REASON_MIN, max: MODERATE_REASON_MAX } : undefined));
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setHideError(null);
    try {
      const run = props.actions.moderate ?? missingAction;
      const trimmed = reason.trim();
      await run({ cid, hidden: true, reason: trimmed });
      props.onHiddenChange(true, trimmed);
      props.setHideOpen(false);
      toast.show({ message: ct('moderateHidden'), tone: 'success' });
    } catch (err) {
      const info = errorOf(err);
      setHideError(reasonText(ct, info.reason, info.params));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function restore(): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const ok = await appConfirm(ct('moderateRestoreConfirm'), { okText: ct('moderateRestore') });
      if (!ok) return;
      const run = props.actions.moderate ?? missingAction;
      await run({ cid, hidden: false });
      props.onHiddenChange(false, null);
      toast.show({ message: ct('moderateRestored'), tone: 'success' });
    } catch (err) {
      const info = errorOf(err);
      toast.show({ message: reasonText(ct, info.reason, info.params), tone: 'error' });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function review(reportId: string, status: ReportReviewStatus): Promise<void> {
    if (rowBusy) return;
    setRowBusy(reportId);
    try {
      const run = props.actions.reviewReport ?? missingAction;
      await run({ cid, reportId, status });
      // 成功只改畫面那一列（+0 讀）。伺服器同時清掉 reopened。
      setReports((prev) => prev?.map((row) => (row.id === reportId ? { ...row, status, reopened: false } : row)) ?? prev);
    } catch (err) {
      const info = errorOf(err);
      toast.show({ message: reasonText(ct, info.reason, info.params), tone: 'error' });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section class="cpa-panel" data-admin-panel>
      <div class="cpa-head">
        <h2 class="cpa-h">{ct('adminArea')}</h2>
        {props.hidden ? <Badge tone="danger" size="sm" label={ct('moderateHidden')} /> : null}
      </div>
      <div class="cpa-btns">
        {props.hidden ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => { void restore(); }}>{ct('moderateRestore')}</Button>
        ) : (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => { setHideError(null); props.setHideOpen(true); }}>{ct('moderateHide')}</Button>
        )}
        <Button variant="secondary" size="sm" aria-expanded={reportsOpen} onClick={toggleReports}>{ct('reportsTitle')}</Button>
      </div>
      {reportsOpen ? (
        <div class="cpa-reports" data-reports>
          {reportsFailed ? (
            <div class="cpa-retry">
              <p class="cps-note cps-warn" role="alert">{ct('loadFailed')}</p>
              <Button variant="secondary" size="sm" onClick={() => { void loadReports(); }}>{ct('retry')}</Button>
            </div>
          ) : reports == null ? (
            <p class="cpa-muted">{ct('reportsLoading')}</p>
          ) : reports.length === 0 ? (
            <p class="cpa-muted">{ct('reportsEmpty')}</p>
          ) : (
            <ul class="cpa-list">
              {reports.map((row) => {
                const badge = statusBadge(ct, row.status);
                const actionable = row.status === 'open' || row.reopened;
                return (
                  <li key={row.id} class="cpa-li" data-report={row.id}>
                    <div class="cpa-li__top">
                      <span class="cpa-reason">{reportReasonLabel(ct, row.reason)}</span>
                      <Badge tone={badge.tone} size="sm" label={badge.label} />
                      {row.reopened ? <Badge tone="danger" size="sm" label={ct('reportReopened')} /> : null}
                    </div>
                    {row.detail ? <p class="cpa-detail">{row.detail}</p> : null}
                    <p class="cpa-meta">
                      <span>{ct('reportCount', { n: row.count })}</span>
                      {row.lastAt != null ? <span>{ct('reportLastAt', { date: formatTaipeiShort(row.lastAt) })}</span> : null}
                    </p>
                    <div class="cpa-btns">
                      {actionable ? (
                        <>
                          <Button variant="secondary" size="sm" disabled={rowBusy != null} onClick={() => { void review(row.id, 'resolved'); }}>{ct('reportMarkResolved')}</Button>
                          <Button variant="ghost" size="sm" disabled={rowBusy != null} onClick={() => { void review(row.id, 'dismissed'); }}>{ct('reportMarkDismissed')}</Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" disabled={rowBusy != null} onClick={() => { void review(row.id, 'open'); }}>{ct('reportReopen')}</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
      {props.hideOpen ? (
        <ModerateDialog
          ct={ct}
          busy={busy}
          error={hideError}
          onSubmit={(reason) => { void hide(reason); }}
          onClose={() => {
            if (busy) return;
            setHideError(null);
            props.setHideOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
