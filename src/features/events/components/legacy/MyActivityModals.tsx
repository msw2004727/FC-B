import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import '@/styles/legacy/edu-info-btn.css';
import { STATUS_CONFIG } from './TimelineEventCard';
import { getEventCreatorName } from './MyActivityCard';
import { loadEventRegistrations } from '../../data/event-detail';
import { effectiveEventStatus } from '../../data/my-activities-model';
import type { EventDoc, RegistrationDoc } from '../../data/types';

export interface MyActivityStatsModalProps {
  open: boolean;
  isAdmin: boolean;
  events: readonly EventDoc[];
  nowMs: number;
  onClose: () => void;
}

export function MyActivityStatsModal({
  open,
  isAdmin,
  events,
  nowMs,
  onClose,
}: MyActivityStatsModalProps): JSX.Element | null {
  if (!open) return null;

  const counts: Record<string, number> = {};
  for (const e of events) {
    const st = effectiveEventStatus(e, nowMs);
    counts[st] = (counts[st] || 0) + 1;
  }

  const scope = isAdmin ? '所有活動' : '我管理的活動';
  const items = [
    { label: '總活動', count: events.length, color: '#0d9488', bg: 'rgba(13,148,136,.1)' },
    { label: '即將開放', count: counts.upcoming || 0, color: '#6366f1', bg: 'rgba(99,102,241,.1)' },
    { label: '報名中', count: counts.open || 0, color: '#10b981', bg: 'rgba(16,185,129,.1)' },
    { label: '已額滿', count: counts.full || 0, color: '#f59e0b', bg: 'rgba(245,158,11,.1)' },
    { label: '已結束', count: counts.ended || 0, color: '#6b7280', bg: 'rgba(107,114,128,.1)' },
    { label: '已取消', count: counts.cancelled || 0, color: '#ef4444', bg: 'rgba(239,68,68,.1)' },
  ];

  const overlay = (
    <div
      class="edu-info-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="活動統計"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div class="edu-info-dialog" style="max-width:360px">
        <div class="edu-info-dialog-title">活動統計</div>
        <div style="font-size:.72rem;color:var(--text-muted);text-align:center;margin-bottom:.6rem">
          {`統計範圍：${scope}`}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.45rem">
          {items.map((it) => (
            <div
              key={it.label}
              style={`background:${it.bg};border-radius:10px;padding:.6rem .7rem;text-align:center`}
            >
              <div style={`font-size:1.4rem;font-weight:800;color:${it.color}`}>
                {it.count}
              </div>
              <div style="font-size:.72rem;color:var(--text-secondary);margin-top:.15rem">
                {it.label}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          class="primary-btn"
          style="width:100%;margin-top:.8rem;flex-shrink:0"
          onClick={onClose}
        >
          關閉
        </button>
      </div>
    </div>
  );

  // createPortal 到 body 會離開頁面的 .legacy-ui，A 的 .edu-info-overlay 樣式（限定在 .legacy-ui 內）就套不到；
  // 比照 ProfileInfoButton／CeInfoDialog 外包一層 .legacy-ui（退修 1 #7：只補 CSS import 還不夠）。
  if (typeof document !== 'undefined') {
    return createPortal(<div class="legacy-ui">{overlay}</div>, document.body);
  }
  return overlay;
}

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

  const ext = event as (EventDoc & { fee?: unknown; feeEnabled?: unknown; current?: unknown }) | null;
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

  const currentCount = Number(ext?.current || 0);
  const confirmedCount = currentCount > 0 ? currentCount : confirmedRegs.length;
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
