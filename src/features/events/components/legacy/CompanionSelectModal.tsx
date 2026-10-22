import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';

export interface CompanionSelectItem {
  id: string;
  name: string;
  gender?: string;
  notes?: string;
  /** 已有有效報名 */
  registered: boolean;
  /** 已報名時的報名文件 ID */
  registrationId?: string;
  /** 已報名時 */
  status?: 'confirmed' | 'waitlisted';
  /** A _canEventGenderParticipantSignup 結果（頁面算好傳入） */
  genderAllowed: boolean;
}

export interface CompanionSelectModalProps {
  open: boolean;
  eventTitle: string;
  feeEnabled: boolean;
  fee: number;
  /** 剩餘名額 */
  remaining: number;
  /** 0 表示不限 */
  max: number;
  /** 有性別限制時「限男生」等，否則 '' */
  genderDetailText: string;
  items: readonly CompanionSelectItem[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (result: { addCompanionIds: string[]; cancelRegistrationIds: string[] }) => void;
}

export interface CompanionSelectionResult {
  selected: number;
  toRegister: number;
  toCancel: number;
  addCompanionIds: string[];
  cancelRegistrationIds: string[];
}

/** 照 A `_updateCompanionSelectSummary` / `_confirmCompanionRegisterUnlocked` 的分批規則。 */
export function computeCompanionSelection(
  items: readonly CompanionSelectItem[],
  checked: ReadonlySet<string>,
): CompanionSelectionResult {
  let selected = 0;
  let toRegister = 0;
  let toCancel = 0;
  const addCompanionIds: string[] = [];
  const cancelRegistrationIds: string[] = [];

  for (const item of items) {
    const isChecked = checked.has(item.id);
    const disabled = !item.registered && !item.genderAllowed;
    if (isChecked) selected += 1;
    if (!disabled && isChecked && !item.registered) {
      toRegister += 1;
      addCompanionIds.push(item.id);
    }
    if (!disabled && !isChecked && item.registered) {
      toCancel += 1;
      if (item.registrationId) cancelRegistrationIds.push(item.registrationId);
    }
  }

  return { selected, toRegister, toCancel, addCompanionIds, cancelRegistrationIds };
}

function initialChecked(items: readonly CompanionSelectItem[]): Set<string> {
  const next = new Set<string>();
  for (const item of items) {
    if (item.registered) next.add(item.id);
  }
  return next;
}

/** M-082 幫夥伴報名彈窗；照 A `_openCompanionSelectModal` / `_updateCompanionSelectSummary`。 */
export function CompanionSelectModal({
  open,
  eventTitle,
  feeEnabled,
  fee,
  remaining,
  max,
  genderDetailText,
  items,
  busy,
  onClose,
  onConfirm,
}: CompanionSelectModalProps): JSX.Element | null {
  const [checked, setChecked] = useState<Set<string>>(() => initialChecked(open ? items : []));
  const prevOpen = useRef(open);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open && !prevOpen.current) setChecked(initialChecked(items));
    prevOpen.current = open;
  }, [open, items]);

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

  const summary = computeCompanionSelection(items, checked);
  const totalChanges = summary.toRegister + summary.toCancel;
  const feeText = feeEnabled ? (fee > 0 ? `費用：NT$${fee}/人` : '費用：免費') : '';
  const remainingDisplay = max <= 0 ? '不限' : `${remaining}/${max}`;
  const waitlistWarningCount = max > 0 && summary.toRegister > remaining
    ? summary.toRegister - remaining
    : 0;

  return (
    <div
      class="modal-overlay open"
      id="companion-select-overlay"
      style="display:flex;align-items:center;justify-content:center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        class="modal companion-select-modal"
        style="position:static;border-radius:var(--radius);transform:none"
      >
        <div class="modal-header">
          <h3>幫夥伴報名</h3>
          <button
            type="button"
            class="modal-close"
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            ×
          </button>
        </div>
        <div class="modal-body">
          <div
            id="companion-select-event-info"
            style="font-size:.8rem;color:var(--text-muted);margin-bottom:.7rem"
          >
            <b>{eventTitle}</b>
            <br />
            {feeText ? `${feeText}　` : ''}剩餘名額：{remainingDisplay}
            {genderDetailText ? (
              <>
                <br />
                <span style="color:#dc2626;font-weight:700">性別限制：{genderDetailText}</span>
              </>
            ) : null}
          </div>
          <div id="companion-select-list" class="companion-select-list">
            {items.map((item) => {
              const isChecked = checked.has(item.id);
              const isRegistered = item.registered;
              const disabled = !isRegistered && !item.genderAllowed;
              const statusClass = isRegistered
                ? (item.status === 'waitlisted' ? ' is-waitlisted' : ' is-active')
                : '';
              const statusLabel = isRegistered
                ? (item.status === 'waitlisted' ? '候補中' : '已報名')
                : (disabled ? '不符限制' : '未報名');
              const rowClass = [
                'companion-toggle-row',
                isChecked ? 'is-selected' : '',
                disabled ? 'is-disabled' : '',
              ].filter(Boolean).join(' ');

              return (
                <label class={rowClass} key={item.id}>
                  <input
                    type="checkbox"
                    name="cs-participant"
                    value="companion"
                    data-companion-id={item.id}
                    data-name={item.name}
                    data-registered={isRegistered ? '1' : '0'}
                    data-reg-id={item.registrationId || ''}
                    checked={isChecked}
                    disabled={disabled}
                    onChange={(e) => {
                      // 停用列不得改變勾選（jsdom 仍會派送 change，真瀏覽器不會）。
                      if (disabled) return;
                      const input = e.currentTarget as HTMLInputElement;
                      const nextChecked = input.checked;
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (nextChecked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
                  />
                  <span class="companion-toggle-main">
                    <span class="companion-toggle-name">
                      {item.name || '同行者'}
                      {item.gender ? (
                        <span class="companion-toggle-gender">{item.gender}</span>
                      ) : null}
                    </span>
                    {item.notes ? (
                      <span class="companion-toggle-note">{item.notes}</span>
                    ) : null}
                  </span>
                  <span class={`companion-toggle-status${statusClass}`}>{statusLabel}</span>
                </label>
              );
            })}
          </div>
          <div
            id="companion-select-summary"
            style="margin-top:.6rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem;background:var(--bg-elevated);display:flex;gap:.8rem;flex-wrap:wrap"
          >
            <span>已勾選 <b>{summary.selected}</b></span>
            <span>新增 <b>{summary.toRegister}</b></span>
            <span>取消 <b>{summary.toCancel}</b></span>
            <span>剩餘 <b>{max <= 0 ? '不限' : remaining}</b></span>
            {feeEnabled && fee > 0 && summary.toRegister > 0 ? (
              <span>新增費用 <b>NT${fee * summary.toRegister}</b></span>
            ) : null}
            {waitlistWarningCount > 0 ? (
              <span style="color:var(--warning);font-weight:700">
                可能有 {waitlistWarningCount} 人進候補
              </span>
            ) : null}
          </div>
        </div>
        <div class="modal-actions">
          <button
            type="button"
            class="outline-btn"
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            取消
          </button>
          <button
            type="button"
            class="primary-btn"
            id="companion-select-confirm-btn"
            disabled={busy || totalChanges === 0}
            onClick={() => {
              // ASSUMPTION: props 沒有 toast；A「沒有需要調整」的提示改以確認鈕 disabled 處理。
              if (busy || totalChanges === 0) return;
              onConfirm({
                addCompanionIds: summary.addCompanionIds,
                cancelRegistrationIds: summary.cancelRegistrationIds,
              });
            }}
          >
            確認
          </button>
        </div>
      </div>
    </div>
  );
}
