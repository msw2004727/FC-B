import type { JSX } from 'preact';
import type { UserRole } from '@/ui/Avatar';
import { UserTag } from '@/ui/UserTag';
import { STATUS_CONFIG } from './TimelineEventCard';
import { effectiveEventStatus } from '../../data/my-activities-model';
import {
  canCancelOwnActivity,
  canDeleteActivity,
  canEditOwnActivityBasic,
  canManageAllActivities,
  canManageEvent,
  canReopenOrRelistActivity,
  type OperateContext,
} from '../../data/operate-permissions';
import { getEventParticipantStats } from '../../data/participant-stats';
import { publicEventHref } from '../../data/presentation';
import { SPORTS, eventSportTag, sportSymbol } from '../../data/sports';
import type { EventDoc } from '../../data/types';

export type LifecycleKind = 'cancel' | 'reopen' | 'relist';

export interface MyActivityCardProps {
  event: EventDoc;
  nowMs: number;
  operateCtx: OperateContext;
  creatorRole?: UserRole;
  onEdit: (event: EventDoc) => void;
  onLifecycle: (kind: LifecycleKind, event: EventDoc) => void;
  onDelete: (event: EventDoc) => void;
  onPin: (event: EventDoc) => void;
  onUnavailable: () => void;
  onNavigate: (href: string) => void;
}

const BTN_STYLE = 'font-size:.72rem;padding:.2rem .5rem';

export function getEventCreatorUid(e: EventDoc): string {
  return String(
    e.creatorUid
    ?? e.ownerUid
    ?? e.captainUid
    ?? e.createdByUid
    ?? e.creatorId
    ?? e.ownerId
    ?? e.organizerUid
    ?? '',
  ).trim();
}

export function getEventCreatorName(e: EventDoc): string {
  return String(
    e.creator
    ?? e.creatorName
    ?? e.ownerName
    ?? e.organizer
    ?? e.organizerDisplay
    ?? '',
  ).trim();
}

export function MyActivityCard({
  event: e,
  nowMs,
  operateCtx,
  creatorRole,
  onEdit,
  onLifecycle,
  onDelete,
  onPin,
  onUnavailable,
  onNavigate,
}: MyActivityCardProps): JSX.Element {
  const ext = e as EventDoc & { pinned?: unknown };
  const isPinned = Boolean(ext.pinned);
  const isExternal = e.type === 'external';
  const effStatus = effectiveEventStatus(e, nowMs);
  const statusConf = STATUS_CONFIG[effStatus] ?? STATUS_CONFIG.open!;

  const canManage = canManageEvent(operateCtx, e);
  // A `_canEditExternalActivity(e)`：有活動時就是 `_canEditOwnActivityBasic(e)`（event-list-helpers.js，已核對）。外部活動編輯本身下一批補。
  const canEdit = canEditOwnActivityBasic(operateCtx, e);
  const canCancel = canCancelOwnActivity(operateCtx, e);
  const canReopenRelist = canReopenOrRelistActivity(operateCtx, e);
  const canDelete = canDeleteActivity(operateCtx, e);
  const canPin = canManageAllActivities(operateCtx) && canManage;

  type ActionBtn = {
    key: string;
    label: string;
    style: string;
    title?: string;
    onClick: (ev: MouseEvent) => void;
  };

  const actionBtns: ActionBtn[] = [];

  if (isExternal) {
    if (canEdit) {
      actionBtns.push({
        key: 'edit-ext',
        label: '編輯',
        style: BTN_STYLE,
        onClick: (ev) => {
          ev.stopPropagation();
          // 下一批補：外部活動編輯（editExternalActivity）
          onUnavailable();
        },
      });
    }
    if (effStatus !== 'cancelled' && canCancel) {
      actionBtns.push({
        key: 'cancel',
        label: '取消',
        style: `${BTN_STYLE};color:var(--danger)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onLifecycle('cancel', e);
        },
      });
    } else if (effStatus === 'cancelled' && canReopenRelist) {
      actionBtns.push({
        key: 'reopen',
        label: '重新開放',
        style: `${BTN_STYLE};color:var(--success)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onLifecycle('reopen', e);
        },
      });
    }
    if (canDelete) {
      actionBtns.push({
        key: 'delete',
        label: '刪除',
        style: `${BTN_STYLE};color:var(--danger)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onDelete(e);
        },
      });
    }
    if (canManage) {
      actionBtns.push({
        key: 'share',
        label: '分享',
        style: `${BTN_STYLE};margin-left:auto;color:var(--accent)`,
        onClick: (ev) => {
          ev.stopPropagation();
          // 下一批補：外部活動分享（shareExternalEvent）
          onUnavailable();
        },
      });
    }
  } else if (effStatus === 'upcoming' || effStatus === 'open' || effStatus === 'full') {
    if (canEdit) {
      actionBtns.push({
        key: 'edit',
        label: '編輯',
        style: BTN_STYLE,
        onClick: (ev) => {
          ev.stopPropagation();
          onEdit(e);
        },
      });
    }
    if (canCancel) {
      actionBtns.push({
        key: 'cancel',
        label: '取消',
        style: `${BTN_STYLE};color:var(--danger)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onLifecycle('cancel', e);
        },
      });
    }
  } else if (effStatus === 'ended') {
    if (canEdit) {
      actionBtns.push({
        key: 'edit',
        label: '編輯',
        style: BTN_STYLE,
        onClick: (ev) => {
          ev.stopPropagation();
          onEdit(e);
        },
      });
    }
    if (canReopenRelist) {
      actionBtns.push({
        key: 'relist',
        label: '上架',
        style: `${BTN_STYLE};color:var(--success)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onLifecycle('relist', e);
        },
      });
    }
    if (canDelete) {
      actionBtns.push({
        key: 'delete',
        label: '刪除',
        style: `${BTN_STYLE};color:var(--danger)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onDelete(e);
        },
      });
    }
  } else if (effStatus === 'cancelled') {
    if (canReopenRelist) {
      actionBtns.push({
        key: 'reopen',
        label: '重新開放',
        style: `${BTN_STYLE};color:var(--success)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onLifecycle('reopen', e);
        },
      });
    }
    if (canDelete) {
      actionBtns.push({
        key: 'delete',
        label: '刪除',
        style: `${BTN_STYLE};color:var(--danger)`,
        onClick: (ev) => {
          ev.stopPropagation();
          onDelete(e);
        },
      });
    }
  }

  // 照 A：canPin 且有至少一顆動作鈕時，置頂按鈕插在第一顆按鈕後面
  if (canPin && actionBtns.length > 0) {
    actionBtns.splice(1, 0, {
      key: 'pin',
      label: isPinned ? '已置頂' : '置頂',
      style: `${BTN_STYLE};opacity:.6;cursor:not-allowed`,
      title: '功能未開放',
      onClick: (ev) => {
        ev.stopPropagation();
        // 下一批補：置頂（toggleMyActivityPin）
        onPin(e);
      },
    });
  }

  const stats = getEventParticipantStats(e, []);
  const confirmedDisplay = stats.confirmedCount;
  const waitlistDisplay = stats.waitlistCount;
  const maxCount = stats.maxCount;
  const progressPct = maxCount > 0 ? Math.min(100, Math.round((confirmedDisplay / maxCount) * 100)) : 0;
  const progressColor =
    progressPct >= 100 ? 'var(--danger)' : progressPct >= 70 ? 'var(--warning)' : 'var(--success)';

  const sportTag = eventSportTag(e) || 'football';
  const sportObj = SPORTS.find((s) => s.sportTag === sportTag);
  const sportLabel = sportObj?.label ?? '足球';
  const symbol = sportSymbol(sportTag);

  const creatorUid = getEventCreatorUid(e);
  const creatorName = getEventCreatorName(e);

  const pinCardStyle = isPinned
    ? ';border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)'
    : '';

  function handleCardClick(ev: JSX.TargetedMouseEvent<HTMLDivElement>): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('button') || target?.closest('.user-capsule') || target?.closest('.ui-user-tag')) {
      return;
    }
    if (isExternal) {
      window.open(e.externalUrl || '', '_blank');
      return;
    }
    const href = publicEventHref(e);
    if (href) {
      onNavigate(href);
    }
  }

  // 下一批補：總管卡片右下角費用摘要 feeBox（需讀取出席簽退紀錄與報名列表，不得新增 Firestore 讀寫）

  return (
    <div
      class="msg-manage-card"
      data-event-id={e.id ?? ''}
      style={`margin-bottom:.5rem;cursor:pointer${pinCardStyle}`}
      onClick={handleCardClick}
    >
      <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
        <span
          class="msg-manage-title"
          style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        >
          {e.title ?? ''}
          {e.teamOnly && (
            <span class="tl-teamonly-badge" style="margin-left:.3rem">
              限定
            </span>
          )}
        </span>
        {isPinned && (
          <span style="font-size:.68rem;color:var(--warning);font-weight:700;border:1px solid var(--warning);border-radius:999px;padding:.05rem .35rem">
            置頂
          </span>
        )}
        <UserTag
          uid={creatorUid}
          name={creatorName}
          role={creatorRole}
          disabled={!creatorUid}
          onOpenProfile={(uid) => {
            if (uid) onNavigate(`/profile/${encodeURIComponent(uid)}`);
          }}
        />
        <span class={`banner-manage-status status-${statusConf.css}`}>
          {statusConf.label}
        </span>
      </div>

      <div style="font-size:.75rem;color:var(--text-muted)">
        {`${e.location || ''} ・ ${e.date || ''}`}
      </div>

      {isExternal ? (
        <div style="font-size:.72rem;color:var(--info);margin-top:.3rem">
          🔗 外部活動連結
        </div>
      ) : (
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div
              style={`width:${progressPct}%;height:100%;background:${progressColor};border-radius:3px;transition:width .3s`}
            />
          </div>
          <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap">
            {`${confirmedDisplay}/${maxCount} 人${waitlistDisplay > 0 ? ' ・ 候補 ' + waitlistDisplay : ''}`}
          </span>
        </div>
      )}

      <div style="display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap;align-items:center">
        <span
          class="event-sport-icon my-event-sport-icon"
          title={sportLabel}
          aria-label={sportLabel}
        >
          <span class="sport-emoji">{symbol}</span>
        </span>
        {actionBtns.map((btn) => (
          <button
            key={btn.key}
            type="button"
            class="outline-btn"
            style={btn.style}
            title={btn.title}
            onClick={btn.onClick}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
