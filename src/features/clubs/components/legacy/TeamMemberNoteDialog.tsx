/**
 * 活動備註編輯框。
 * 對應 A team-detail.js:1642-1683 _promptTeamMemberNoteData；
 * 儲存編排對應 :1685-1768 editTeamMemberNote。
 *
 * 與 A 差異：JSX portal、獨立 ID、焦點循環／還原、返回鍵與 busy 守衛；
 * 除 maxlength 外以 JS 截斷為 120 字。本元件不寫文件或 opLog、不提供剔除；
 * 不寫 members 與角色通知／稽核 best-effort 由動作層負責。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';

export interface TeamMemberNoteDialogProps {
  memberName: string;
  initialNote: string;
  busy?: boolean;
  onSave: (notes: string) => void;
  onCancel: () => void;
}

export function TeamMemberNoteDialog(props: TeamMemberNoteDialogProps): JSX.Element {
  const [notes, setNotes] = useState(() =>
    (props.initialNote && props.initialNote !== '-' ? props.initialNote : '').slice(0, 120),
  );
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const latest = useRef(props);
  latest.current = props;
  const editorRef = useRef<HTMLTextAreaElement>(null);
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
      const controls = [editorRef.current, cancelRef.current, saveRef.current].filter(
        (element): element is HTMLTextAreaElement | HTMLButtonElement =>
          element !== null && !element.disabled,
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
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }

    return () => {
      document.removeEventListener('keydown', handleKey, true);
      releaseBack();
      unlock();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  return createPortal(
    <div class="legacy-ui">
      <div
        id="team-member-note-modal"
        class="app-confirm-overlay open"
        onClick={(event) => {
          if (event.target === event.currentTarget && !latest.current.busy) {
            latest.current.onCancel();
          }
        }}
      >
        <div
          class="app-confirm-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-member-note-title"
        >
          <div class="app-confirm-msg">
            <div class="td-member-match-form">
              <strong id="team-member-note-title">編輯活動備註</strong>
              <span>{props.memberName}</span>
              <label>
                備註
                <textarea
                  ref={editorRef}
                  id="td-member-note-editor"
                  rows={3}
                  maxLength={120}
                  value={notes}
                  onInput={(event) => {
                    if (latest.current.busy) {
                      event.currentTarget.value = notesRef.current;
                      return;
                    }
                    const next = event.currentTarget.value.slice(0, 120);
                    // 即使截斷後 state 沒變，也要立即修正貼入的 DOM 值。
                    event.currentTarget.value = next;
                    notesRef.current = next;
                    setNotes(next);
                  }}
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
                if (!latest.current.busy) {
                  latest.current.onSave(notesRef.current.slice(0, 120).trim());
                }
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
