/**
 * 職務升降確認框。
 * 對應 A team-detail.js:1362-1434 _buildTeamRoleChangeConfirmText、
 * _buildTeamRoleChangeConfirmHtml 與 _confirmTeamMemberRoleLevelChange。
 *
 * 與 A 差異：採 JSX portal 與獨立 modal ID，不改寫 innerHTML；
 * 補上返回鍵、焦點循環／還原及 busy 守衛。本元件不執行寫入或剔除；
 * 不寫 members、通知／稽核 best-effort 與備註 120 字硬上限由動作層負責。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';

import type { MemberRoleTarget } from '../../club-policy';
import { getRoleChangeLabels } from './member-management-actions';

export interface TeamRoleConfirmDialogProps {
  memberName: string;
  currentRole: 'captain' | 'leader' | 'coach' | 'member';
  target: MemberRoleTarget;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ROLE_CLASSES = {
  captain: 'role-manager',
  leader: 'role-leader',
  coach: 'role-coach',
  member: 'role-default',
} as const;

const ROLE_NAMES = {
  captain: '球經',
  leader: '領隊',
  coach: '教練',
  member: '隊員',
} as const;

export function TeamRoleConfirmDialog(props: TeamRoleConfirmDialogProps): JSX.Element {
  const latest = useRef(props);
  latest.current = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const unlock = lockBody(document.body);

    const cancel = (): boolean => {
      if (latest.current.busy) return false;
      latest.current.onCancel();
      return true;
    };
    const releaseBack = pushOverlay(cancel);

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [cancelRef.current, confirmRef.current].filter(
        (element): element is HTMLButtonElement => element !== null && !element.disabled,
      );
      if (controls.length === 0) return;

      event.preventDefault();
      const index = controls.findIndex((element) => element === document.activeElement);
      const next = index < 0
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next]?.focus();
    };

    document.addEventListener('keydown', handleKey, true);
    cancelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKey, true);
      releaseBack();
      unlock();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  const { memberName, currentRole, target, busy = false } = props;
  const { actionText, roleName } = getRoleChangeLabels(target);

  return createPortal(
    <div class="legacy-ui">
      <div
        id="team-role-confirm-modal"
        class="app-confirm-overlay open td-role-confirm-open"
        onClick={(event) => {
          if (event.target === event.currentTarget && !latest.current.busy) {
            latest.current.onCancel();
          }
        }}
      >
        <div
          class="app-confirm-box td-role-confirm-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-role-confirm-title"
        >
          <div class="app-confirm-msg">
            <div class="td-role-confirm-card">
              <div class="td-role-confirm-heading">
                <span class="td-role-confirm-kicker" id="team-role-confirm-title">
                  俱樂部成員層級調整
                </span>
                <span class={`td-role-confirm-action ${target.direction}`}>
                  {actionText}確認
                </span>
              </div>
              <div class="td-role-confirm-flow">
                <span
                  class={`td-role-confirm-name-pill ${ROLE_CLASSES[currentRole]}`}
                  data-no-translate=""
                >
                  {memberName}
                </span>
                <span class={`td-role-confirm-role-pill ${ROLE_CLASSES[currentRole]}`}>
                  {`目前 ${ROLE_NAMES[currentRole]}`}
                </span>
                <span
                  class={`td-role-confirm-arrow ${target.direction}`}
                  aria-hidden="true"
                >
                  →
                </span>
                <span class={`td-role-confirm-role-pill ${ROLE_CLASSES[target.key]}`}>
                  {`${actionText}為 ${roleName}`}
                </span>
              </div>
              <div class="td-role-confirm-meta">
                確認後將立即同步更新成員名單與俱樂部設定。
              </div>
            </div>
          </div>
          <div class="app-confirm-btns">
            <button
              ref={cancelRef}
              type="button"
              class="app-confirm-cancel"
              style={{ minWidth: '44px', minHeight: '44px' }}
              onClick={() => {
                if (!latest.current.busy) latest.current.onCancel();
              }}
            >
              取消
            </button>
            <button
              ref={confirmRef}
              type="button"
              class="app-confirm-ok"
              style={{ minWidth: '44px', minHeight: '44px' }}
              disabled={busy}
              onClick={() => {
                if (!latest.current.busy) latest.current.onConfirm();
              }}
            >
              {`確認${actionText}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
