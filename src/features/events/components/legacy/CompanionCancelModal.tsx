import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { ActionRingButton, useActionRingControl, type ActionRingControl } from '@/ui/action-ring';
import {
  buildCompanionLateCancelNote,
  type LateCancelEvent,
  type LateCancelUserInfo,
} from '../../data/late-cancel';

export interface CompanionCancelTarget {
  registrationId: string;
  isSelf: boolean;
  /** 本人顯示名或同行者名 */
  name: string;
  status: 'confirmed' | 'waitlisted';
  courseStudentId?: string;
  courseLinkId?: string;
  /** 取消這筆可能記一次臨時取消（正取、非課程、不是時限內才遞補）。 */
  lateEligible?: boolean;
}

/** 臨時取消提示需要的資料（預覽 ⑤-3）；null／未傳＝不提示。 */
export interface CompanionCancelLateInfo {
  event: LateCancelEvent;
  waitlistCount: number;
  user: LateCancelUserInfo | null | undefined;
}

export interface CompanionCancelModalProps {
  open: boolean;
  targets: readonly CompanionCancelTarget[];
  selectAll: boolean;
  busy: boolean;
  /** 「確認取消」的進度環；由取消流程在真正送出時 start、依結果 succeed／fail。 */
  ring?: ActionRingControl;
  /** 照 A：標題「取消報名 — ${e.title}」。 */
  eventTitle?: string;
  onClose: () => void;
  /** 至少勾一個才可按 */
  onConfirm: (registrationIds: string[]) => void;
  lateCancel?: CompanionCancelLateInfo | null;
}

/** 照 A `_getCompanionCancelTargetLabel`。 */
export function getCompanionCancelTargetLabel(target: CompanionCancelTarget): string {
  if (!target.isSelf) {
    const name = target.name.trim();
    return name ? `夥伴${name}` : '夥伴';
  }
  // ASSUMPTION: B 的 target 沒有 courseLinkSource/source；以 courseStudentId/courseLinkId 判斷課程學員。
  const isCourseStudent = !!target.courseStudentId || !!target.courseLinkId;
  if (isCourseStudent) {
    return `課程學員${target.name ? `「${target.name}」` : ''}`;
  }
  return '本人';
}

/** 照 A `_formatCompanionCancelTargetList`。 */
export function formatCompanionCancelTargetList(labels: readonly string[]): string {
  const items = labels.filter(Boolean);
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return items.join('與');
  const last = items[items.length - 1] ?? '';
  return items.slice(0, -1).join('、') + '與' + last;
}

/** 照 A `_updateCompanionCancelWarn`。 */
export function buildCompanionCancelWarn(
  targets: readonly CompanionCancelTarget[],
  checkedIds: ReadonlySet<string>,
): string {
  const labels = targets
    .filter((target) => target.registrationId && checkedIds.has(target.registrationId))
    .map((target) => getCompanionCancelTargetLabel(target));
  return labels.length
    ? `注意：確認取消後將會取消${formatCompanionCancelTargetList(labels)}`
    : '注意：請至少勾選一位要取消的對象';
}

function initialChecked(
  open: boolean,
  selectAll: boolean,
  targets: readonly CompanionCancelTarget[],
): Set<string> {
  if (!open || !selectAll) return new Set<string>();
  return new Set(targets.map((target) => target.registrationId));
}

/** M-081 取消報名彈窗；照 A `_openCompanionCancelModal` / `_updateCompanionCancelWarn`。 */
export function CompanionCancelModal({
  open,
  targets,
  selectAll,
  busy,
  ring,
  eventTitle,
  onClose,
  onConfirm,
  lateCancel = null,
}: CompanionCancelModalProps): JSX.Element | null {
  const idleRing = useActionRingControl();
  const [checked, setChecked] = useState<Set<string>>(
    () => initialChecked(open, selectAll, targets),
  );
  const prevOpen = useRef(open);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open && !prevOpen.current) setChecked(initialChecked(open, selectAll, targets));
    prevOpen.current = open;
  }, [open, selectAll, targets]);

  // 照 A：開啟時登記實體返回鍵；busy 時返回鍵不關。
  useEffect(() => {
    if (!open) return;
    const release = pushOverlay(() => {
      if (busyRef.current) return false;
      onCloseRef.current();
      return true;
    });
    return () => {
      release();
    };
  }, [open]);

  if (!open) return null;

  const selectedIds = new Set<string>();
  for (const id of checked) {
    if (id) selectedIds.add(id);
  }
  const warnText = buildCompanionCancelWarn(targets, selectedIds);
  const confirmDisabled = busy || selectedIds.size === 0;
  const checkedTargets = targets.filter((target) => selectedIds.has(target.registrationId));
  const lateNote = lateCancel ? buildCompanionLateCancelNote({
    event: lateCancel.event,
    nowMs: Date.now(),
    eligibleCount: checkedTargets.filter((target) => target.lateEligible).length,
    confirmedCount: checkedTargets.filter((target) => target.status === 'confirmed').length,
    waitlistCount: lateCancel.waitlistCount,
    user: lateCancel.user,
    selfChecked: checkedTargets.some((target) => target.isSelf),
  }) : null;

  return (
    <div
      class="modal-overlay open"
      id="companion-cancel-overlay"
      style="display:flex;align-items:center;justify-content:center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        class="modal"
        style="max-width:360px;position:static;border-radius:var(--radius);transform:none"
      >
        <div class="modal-header">
          <h3 id="companion-cancel-title">{eventTitle ? `取消報名 — ${eventTitle}` : '取消報名'}</h3>
          <button
            type="button"
            class="modal-close"
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          {lateNote && (
            <div
              id="companion-cancel-late-warn"
              style="font-size:var(--font-size-body);font-weight:700;color:var(--danger);text-align:center;margin-bottom:.5rem"
            >
              {lateNote.warn}
            </div>
          )}
          <div
            style="font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem"
          >
            請選擇要取消的報名：
          </div>
          <div
            id="companion-cancel-warn"
            style="font-size:.78rem;color:var(--danger);padding:.3rem .5rem;border-radius:var(--radius-sm);background:rgba(239,68,68,.08);margin-bottom:.4rem"
          >
            {warnText}
          </div>
          <div style="margin-bottom:.4rem">
            <button
              type="button"
              class="outline-btn"
              style="font-size:.75rem;padding:.2rem .6rem"
              onClick={() => {
                setChecked(new Set(targets.map((target) => target.registrationId)));
              }}
            >
              全選
            </button>
          </div>
          <div id="companion-cancel-list">
            {targets.map((target, index) => {
              const isChecked = checked.has(target.registrationId);
              const tag = target.status === 'confirmed' ? '正取' : '候補';
              const tagColor = target.status === 'confirmed' ? 'var(--success)' : 'var(--warning)';
              const identityLabel = target.isSelf
                ? ((target.courseStudentId || target.courseLinkId) ? '（課程學員）' : '（本人）')
                : '';

              return (
                <label
                  key={`${target.registrationId}-${index}`}
                  style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer"
                >
                  <input
                    type="checkbox"
                    name="cc-reg"
                    value={target.registrationId}
                    checked={isChecked}
                    disabled={!target.registrationId}
                    style="width:16px;height:16px"
                    onChange={(e) => {
                      const input = e.currentTarget as HTMLInputElement;
                      const nextChecked = input.checked;
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (nextChecked) next.add(target.registrationId);
                        else next.delete(target.registrationId);
                        return next;
                      });
                    }}
                  />
                  <span style="flex:1;font-size:.85rem">
                    {target.name}{identityLabel}
                  </span>
                  <span
                    style={`font-size:.72rem;padding:.1rem .3rem;border-radius:3px;background:${tagColor}22;color:${tagColor}`}
                  >
                    {tag}
                  </span>
                </label>
              );
            })}
          </div>
          {lateNote && (
            <div
              id="companion-cancel-late-msg"
              style="margin-top:.8rem;text-align:center;font-size:var(--font-size-body);font-weight:600;line-height:1.5;color:var(--text-primary)"
            >
              {lateNote.message}
              <span style="display:block;margin-top:.4rem;font-size:var(--font-size-body-sm);font-weight:400;color:var(--text-secondary);white-space:nowrap">
                {lateNote.sub}
              </span>
            </div>
          )}
        </div>
        <div class="modal-actions">
          <button
            type="button"
            class="outline-btn"
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            {lateNote ? '保留名額' : '返回'}
          </button>
          <ActionRingButton
            control={ring ?? idleRing}
            busyLabel="取消報名中..."
            type="button"
            class="primary-btn"
            style="background:var(--danger)"
            disabled={confirmDisabled}
            onClick={() => {
              if (confirmDisabled) return;
              const ids = targets
                .filter((target) => target.registrationId && checked.has(target.registrationId))
                .map((target) => target.registrationId);
              onConfirm(ids);
            }}
          >
            {lateNote ? '仍要取消' : '確認取消'}
          </ActionRingButton>
        </div>
      </div>
    </div>
  );
}
