import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

/**
 * M-127：同行者新增／編輯彈窗（照 A `pages/modals.html#companion-modal-overlay`、
 * `profile-data-history.js#openCompanionModal/closeCompanionModal/saveCompanion`）。
 * createPortal 到 body、外包 `.legacy-ui`；Danger「請填寫姓名」toast 由彈窗自己處理，
 * 送出成功由父層 `LegacyCompanionsCard` 處理。
 */

export interface CompanionDraft {
  id: string;
  name: string;
  gender: string;
  notes: string;
}

export interface CompanionModalProps {
  mode: 'add' | 'edit';
  initial?: CompanionDraft;
  pending: boolean;
  onClose: () => void;
  onSave: (draft: CompanionDraft) => void;
}

export function CompanionModal(props: CompanionModalProps): JSX.Element {
  const lt = useLegacyT();
  const { mode, initial, pending, onClose, onSave } = props;

  // 照 A openCompanionModal：編輯用既有值、新增一切空白。id 不隱藏欄位以外另存 state。
  const id = initial?.id ?? '';
  const [name, setName] = useState(initial?.name ?? '');
  const [gender, setGender] = useState(initial?.gender ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  // 照 A closeCompanionModal：返回鍵先關彈窗（callback 放 ref 避免重繪重推歷史）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const release = pushOverlay(() => {
      closeRef.current();
      return true;
    });
    return () => {
      release();
    };
  }, []);

  // 照 A saveCompanion：姓名 trim 後為空 → toast「請填寫姓名」。
  const submit = (): void => {
    if (pending) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.show({ message: lt('請填寫姓名', '請填寫姓名') });
      return;
    }
    onSave({ id, name: trimmedName, gender, notes: notes.trim() });
  };

  return createPortal(
    <div class="legacy-ui">
      <div
        class="modal-overlay open"
        id="companion-modal-overlay"
        style="display:flex;align-items:center;justify-content:center"
        onClick={(ev) => {
          // 照 A：點遮罩（非彈窗本體）關閉；送出中不可關。
          if (ev.target === ev.currentTarget && !pending) onClose();
        }}
      >
        <div
          class="modal"
          style="max-width:340px;position:static;border-radius:var(--radius);transform:none"
        >
          <div class="modal-header">
            <h3 id="companion-modal-title">
              {mode === 'edit'
                ? lt('編輯同行者', '編輯同行者')
                : lt('新增同行者', '新增同行者')}
            </h3>
            <button
              type="button"
              class="modal-close"
              aria-label={lt('關閉', '關閉')}
              onClick={() => {
                if (!pending) onClose();
              }}
            >
              ✕
            </button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="companion-modal-id" value={id} readOnly />
            <div style="margin-bottom:.6rem">
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.3rem">
                {lt('姓名', '姓名')} <span style="color:var(--danger)">*</span>
              </label>
              <input
                type="text"
                id="companion-modal-name"
                maxLength={20}
                placeholder={lt('輸入姓名', '輸入姓名')}
                value={name}
                disabled={pending}
                onInput={(ev) => setName(ev.currentTarget.value)}
                style="width:100%;padding:.5rem .7rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);font-size:.85rem;box-sizing:border-box"
              />
            </div>
            <div style="margin-bottom:.6rem">
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.3rem">
                {lt('性別', '性別')}
              </label>
              <select
                id="companion-modal-gender"
                value={gender}
                disabled={pending}
                onChange={(ev) => setGender(ev.currentTarget.value)}
                style="width:100%;padding:.5rem .7rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);font-size:.85rem"
              >
                <option value="">{lt('不填', '不填')}</option>
                <option value="男">{lt('男', '男')}</option>
                <option value="女">{lt('女', '女')}</option>
              </select>
            </div>
            <div>
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.3rem">
                {lt('備註', '備註')}
              </label>
              <textarea
                id="companion-modal-notes"
                rows={2}
                maxLength={50}
                placeholder={lt('例：家人、朋友（最多50字）', '例：家人、朋友（最多50字）')}
                value={notes}
                disabled={pending}
                onInput={(ev) => setNotes(ev.currentTarget.value)}
                style="width:100%;padding:.5rem .7rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);font-size:.85rem;resize:none;box-sizing:border-box"
              />
            </div>
          </div>
          <div class="modal-actions">
            <button
              type="button"
              class="outline-btn"
              disabled={pending}
              onClick={() => {
                if (!pending) onClose();
              }}
            >
              {lt('取消', '取消')}
            </button>
            <button
              type="button"
              class="primary-btn"
              disabled={pending}
              onClick={submit}
            >
              {lt('儲存', '儲存')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
