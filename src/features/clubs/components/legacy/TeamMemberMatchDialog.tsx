/**
 * 背號／位置編輯框（K6）。對應 A team-detail.js `_promptTeamMemberMatchData`：
 * 標題「編輯賽事數據」、成員名、背號（12）／位置（20）／備註（80）三欄，按鈕「取消／儲存」。
 * 互動（portal、焦點循環、返回鍵、busy 守衛）沿用 TeamMemberNoteDialog；本元件不寫文件。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';
import { MEMBER_MATCH_LIMITS } from '../../data/teams-write';

export interface TeamMemberMatchValue {
  jerseyNumber: string;
  position: string;
  notes: string;
}

export interface TeamMemberMatchDialogProps {
  memberName: string;
  initial: TeamMemberMatchValue;
  busy?: boolean;
  onSave: (value: TeamMemberMatchValue) => void;
  onCancel: () => void;
}

/** A：顯示值 '-' 視為空。 */
function initialText(value: string, max: number): string {
  return (value && value !== '-' ? value : '').slice(0, max);
}

export function TeamMemberMatchDialog(props: TeamMemberMatchDialogProps): JSX.Element {
  const [value, setValue] = useState<TeamMemberMatchValue>(() => ({
    jerseyNumber: initialText(props.initial.jerseyNumber, MEMBER_MATCH_LIMITS.jerseyNumber),
    position: initialText(props.initial.position, MEMBER_MATCH_LIMITS.position),
    notes: initialText(props.initial.notes, MEMBER_MATCH_LIMITS.notes),
  }));
  const valueRef = useRef(value);
  valueRef.current = value;
  const latest = useRef(props);
  latest.current = props;
  const jerseyRef = useRef<HTMLInputElement>(null);
  const positionRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

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
      const controls = [
        jerseyRef.current, positionRef.current, notesRef.current, cancelRef.current, saveRef.current,
      ].filter((el): el is HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement => el !== null && !el.disabled);
      if (controls.length === 0) return;
      event.preventDefault();
      const index = controls.findIndex((el) => el === document.activeElement);
      const next = index < 0
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next]?.focus();
    };
    document.addEventListener('keydown', handleKey, true);
    jerseyRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      releaseBack();
      unlock();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const update = (field: keyof TeamMemberMatchValue, el: HTMLInputElement | HTMLTextAreaElement): void => {
    if (latest.current.busy) {
      el.value = valueRef.current[field];
      return;
    }
    const next = el.value.slice(0, MEMBER_MATCH_LIMITS[field]);
    el.value = next;
    const merged = { ...valueRef.current, [field]: next };
    valueRef.current = merged;
    setValue(merged);
  };

  return createPortal(
    <div class="legacy-ui">
      <div
        id="team-member-match-modal"
        class="app-confirm-overlay open"
        onClick={(event) => {
          if (event.target === event.currentTarget && !latest.current.busy) latest.current.onCancel();
        }}
      >
        <div class="app-confirm-box" role="dialog" aria-modal="true" aria-labelledby="team-member-match-title">
          <div class="app-confirm-msg">
            <div class="td-member-match-form">
              <strong id="team-member-match-title">編輯賽事數據</strong>
              <span>{props.memberName}</span>
              <label>
                背號
                <input
                  ref={jerseyRef}
                  id="td-member-match-jersey"
                  maxLength={MEMBER_MATCH_LIMITS.jerseyNumber}
                  value={value.jerseyNumber}
                  onInput={(event) => update('jerseyNumber', event.currentTarget)}
                />
              </label>
              <label>
                位置
                <input
                  ref={positionRef}
                  id="td-member-match-position"
                  maxLength={MEMBER_MATCH_LIMITS.position}
                  value={value.position}
                  onInput={(event) => update('position', event.currentTarget)}
                />
              </label>
              <label>
                備註
                <textarea
                  ref={notesRef}
                  id="td-member-match-notes"
                  rows={2}
                  maxLength={MEMBER_MATCH_LIMITS.notes}
                  value={value.notes}
                  onInput={(event) => update('notes', event.currentTarget)}
                />
              </label>
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
              ref={saveRef}
              type="button"
              class="app-confirm-ok"
              style={{ minWidth: '44px', minHeight: '44px' }}
              disabled={props.busy ?? false}
              onClick={() => {
                if (latest.current.busy) return;
                const current = valueRef.current;
                latest.current.onSave({
                  jerseyNumber: current.jerseyNumber.trim(),
                  position: current.position.trim(),
                  notes: current.notes.trim(),
                });
              }}
            >
              儲存
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
