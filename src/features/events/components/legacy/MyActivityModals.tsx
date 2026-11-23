import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@/styles/legacy/edu-info-btn.css';
import { STATUS_CONFIG } from './TimelineEventCard';
import { getEventCreatorName } from './MyActivityCard';
import { loadEventRegistrations } from '../../data/event-detail';
import { actualConfirmedCount, type DetailEvent } from '../../data/detail-model';
import { effectiveEventStatus } from '../../data/my-activities-model';
import type { EventDoc, RegistrationDoc } from '../../data/types';

export interface MyActivityDetailModalProps {
  event: EventDoc | null;
  isSuperAdmin: boolean;
  nowMs: number;
  onClose: () => void;
}

type RegExtra = RegistrationDoc & {
  userName?: unknown;
  companionId?: unknown;
  companionName?: unknown;
  fee?: unknown;
};

export function MyActivityDetailModal({
  event,
  isSuperAdmin,
  nowMs,
  onClose,
}: MyActivityDetailModalProps): JSX.Element {
  const [regs, setRegs] = useState<RegistrationDoc[]>([]);
  const [loading, setLoading] = useState(false);

  const eventDocId = event ? String(event._docId ?? event.docId ?? event.id ?? '') : '';

  useEffect(() => {
    if (!eventDocId) {
      setRegs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadEventRegistrations(eventDocId)
      .then((list) => {
        if (!cancelled) {
          setRegs(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRegs([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventDocId]);

  const ext = event as (EventDoc & { fee?: unknown; feeEnabled?: unknown }) | null;
  const effStatus = event ? effectiveEventStatus(event, nowMs) : 'open';
  const statusConf = STATUS_CONFIG[effStatus] ?? STATUS_CONFIG.open!;
  const feeNum = Number(ext?.fee || 0);
  const fee = feeNum > 0 ? Math.floor(feeNum) : 0;
  const feeEnabled = Boolean(ext?.feeEnabled) || fee > 0;

  const metaParts: string[] = [];
  if (feeEnabled || fee > 0) {
    metaParts.push(`費用：${fee > 0 ? 'NT$' + fee : '免費'}`);
  }
  metaParts.push(`狀態：${statusConf.label}`);

  const confirmedRegs = regs.filter(
    (r) => r.status === 'confirmed' || r.status === 'registered',
  ) as RegExtra[];
  const waitlistedRegs = regs.filter((r) => r.status === 'waitlisted') as RegExtra[];

  // 應收人數用實際正取（detail-model#actualConfirmedCount，不含團隊未報）；為 0 時退回本彈窗的正取名單人數（計數過期時與「正取名單（N）」標題一致，照 A 彈窗 event-manage.js:580）。
  // 卡片應收（manage-fee-summary）是名單人數優先，計數過期時兩者可能差 1～2 人；此彈窗目前無入口，不另統一。
  // A `_renderDetailFeeSummary` 用 e.current（Functions 寫入的 current＝realCurrent＋團隊未報）會多算，B 不照搬（顧問 §3.136 ②）。
  const actualCount = event ? actualConfirmedCount(event as DetailEvent) : 0;
  const confirmedCount = actualCount > 0 ? actualCount : confirmedRegs.length;
  // 下一批補：簽到/簽退/未報名掃碼紀錄讀取（目前無既有讀取函式，checkoutCount 暫為 0）
  const checkoutCount = 0;
  const feeExpected = fee * confirmedCount;
  const feeActual = fee * checkoutCount;
  const feeShort = feeExpected - feeActual;

  const creatorName = event ? getEventCreatorName(event) : '';

  return (
    <div
      id="my-activity-detail-modal"
      style={{
        display: event ? 'flex' : 'none',
        position: 'fixed',
        inset: '0',
        zIndex: 1200,
        background: 'rgba(0,0,0,.35)',
        WebkitBackdropFilter: 'blur(10px)',
        backdropFilter: 'blur(10px)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div style="background:var(--bg-card);border-radius:var(--radius-lg);max-width:440px;width:92%;max-height:85vh;overflow-y:auto;padding:1.2rem;position:relative">
        <button
          type="button"
          style="position:absolute;top:.6rem;right:.8rem;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)"
          onClick={onClose}
        >
          ✕
        </button>
        <div id="my-activity-detail-content">
          {event && (
            <>
              <h3 style="margin:0 0 .4rem;font-size:1rem">{event.title ?? ''}</h3>
              <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.6rem">
                <div>{`${event.location ?? ''} ・ ${event.date ?? ''}`}</div>
                <div>
                  {metaParts.join(' ・ ')}
                  {' ・ 主辦：'}
                  <span data-no-translate>{creatorName}</span>
                </div>
              </div>
              <div id="attendance-table-container">
                {loading ? (
                  <div class="reg-loading">載入中...</div>
                ) : confirmedRegs.length === 0 ? (
                  <div style="font-size:.82rem;color:var(--text-muted);padding:.4rem 0">
                    此功能尚未開放，請先使用舊版
                  </div>
                ) : (
                  <div>
                    <div style="font-size:.85rem;font-weight:700;margin:.4rem 0 .3rem">
                      {`正取名單（${confirmedRegs.length}）`}
                    </div>
                    {confirmedRegs.map((r, i) => {
                      const name = String(r.companionName || r.userName || r.userId || r.uid || '');
                      return (
                        <div
                          key={r.id ?? r._docId ?? `c-${i}`}
                          style="display:flex;align-items:center;gap:.4rem;padding:.25rem 0;border-bottom:1px solid var(--border)"
                        >
                          <span style="font-size:.82rem;flex:1" data-no-translate>
                            {name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div id="waitlist-table-container">
                {!loading && waitlistedRegs.length > 0 && (
                  <div>
                    <div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem">
                      {`候補名單（${waitlistedRegs.length}）`}
                    </div>
                    {waitlistedRegs.map((r, i) => {
                      const name = String(r.companionName || r.userName || r.userId || r.uid || '');
                      return (
                        <div
                          key={r.id ?? r._docId ?? `w-${i}`}
                          style="display:flex;align-items:center;gap:.4rem;padding:.25rem 0;border-bottom:1px solid var(--border)"
                        >
                          <span style="font-size:.82rem;flex:1" data-no-translate>
                            {name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* 下一批補：📍 簽到紀錄 / ✅ 簽退紀錄 / ⚠️ 未報名掃碼（需讀取 attendanceRecords，不得新增 Firestore 讀寫） */}
              {isSuperAdmin && (
                <div id="detail-fee-summary">
                  {fee > 0 && (
                    <div style="margin:.6rem 0 .2rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated);font-size:.78rem;display:flex;gap:.8rem;flex-wrap:wrap">
                      <span>
                        {'應收 '}
                        <b style="color:var(--text-primary)">{`$${feeExpected}`}</b>
                      </span>
                      <span>
                        {'實收 '}
                        <b style="color:var(--success)">{`$${feeActual}`}</b>
                      </span>
                      <span>
                        {'短收 '}
                        <b style={`color:${feeShort > 0 ? 'var(--danger)' : 'var(--success)'}`}>
                          {`$${feeShort}`}
                        </b>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
