/**
 * 編輯通知腳本疊窗。DOM／行內樣式照 A `#notif-template-editor` 與 `message-notify.js#showTemplateEditor`／`#saveAllTemplates`。
 * 頂部「使用 {佔位符}…」說明句與每份範本的「佔位符：…」清單都照 A 保留
 * （R-UI-026：照 A 搬的畫面文案仍照 A；站長 Q11 拿掉說明只針對小遊戲與頭像檢測）。
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { MSG_BODY_MAX, MSG_TITLE_MAX } from '../data/admin-message-model';
import {
  TEMPLATE_PLACEHOLDER_HINTS,
  loadEditableTemplates,
  saveTemplates,
  type EditableTemplate,
} from '../data/notif-templates-admin';
import { AdminOverlay } from './AdminOverlay';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; original: EditableTemplate[] };

export function TemplateEditorModal({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useT();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [drafts, setDrafts] = useState<EditableTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    setState({ status: 'loading' });
    loadEditableTemplates().then(
      (list) => {
        if (disposed) return;
        setState({ status: 'ready', original: list });
        setDrafts(list.map((tpl) => ({ ...tpl })));
      },
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[TemplateEditor] load failed:', err);
        if (!disposed) setState({ status: 'error' });
      },
    );
    return () => {
      disposed = true;
    };
  }, [attempt]);

  function patch(key: string, field: 'title' | 'body', value: string): void {
    setDrafts((prev) => prev.map((tpl) => (tpl.key === key ? { ...tpl, [field]: value } : tpl)));
  }

  async function saveAll(): Promise<void> {
    if (busy || state.status !== 'ready') return;
    setBusy(true);
    try {
      await saveTemplates(state.original, drafts);
      toast.show({ message: t('inbox.admin.templates.saved'), tone: 'success' });
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[updateNotifTemplate]', err);
      toast.show({ message: t('inbox.admin.templates.saveFailed'), tone: 'error' });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <AdminOverlay
      id="notif-template-editor"
      boxStyle="background:var(--bg-card);border-radius:var(--radius-lg);max-width:460px;width:92%;max-height:85vh;overflow-y:auto;padding:1.2rem;position:relative"
      closeOnBackdrop
      busy={busy}
      labelledBy="notif-template-title"
      onClose={onClose}
    >
      <div class="role-editor-header" style="margin-bottom:.6rem">
        <span id="notif-template-title" style="font-size:.95rem;font-weight:700">{t('inbox.admin.templates.title')}</span>
        <button
          type="button"
          aria-label={t('inbox.admin.close')}
          style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)"
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          ✕
        </button>
      </div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.8rem">{t('inbox.admin.templates.intro')}</div>
      <div id="notif-template-list">
        {state.status === 'loading' ? (
          <div role="status" style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.82rem">
            {t('inbox.admin.loading')}
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div role="alert" style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.82rem">
            <div>{t('inbox.admin.loadError')}</div>
            <button type="button" class="outline-btn" style="margin-top:.6rem" onClick={() => setAttempt((n) => n + 1)}>
              {t('inbox.admin.retry')}
            </button>
          </div>
        ) : null}
        {state.status === 'ready'
          ? drafts.map((tpl) => (
            <div key={tpl.key} class="form-card" style="margin-bottom:.6rem" data-tpl-card={tpl.key}>
              <div style="font-size:.82rem;font-weight:700;margin-bottom:.3rem">{tpl.key}</div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.4rem">
                {t('inbox.admin.templates.placeholder', { value: TEMPLATE_PLACEHOLDER_HINTS[tpl.key] ?? t('inbox.admin.templates.none') })}
              </div>
              <div class="form-row">
                <label for={`tpl-${tpl.key}-title`}>{t('inbox.admin.templates.titleLabel')}</label>
                <input
                  type="text"
                  id={`tpl-${tpl.key}-title`}
                  data-tpl-key={tpl.key}
                  data-tpl-field="title"
                  maxLength={MSG_TITLE_MAX}
                  value={tpl.title}
                  onInput={(e) => patch(tpl.key, 'title', e.currentTarget.value)}
                />
              </div>
              <div class="form-row">
                <label for={`tpl-${tpl.key}-body`}>{t('inbox.admin.templates.bodyLabel')}</label>
                <textarea
                  id={`tpl-${tpl.key}-body`}
                  data-tpl-key={tpl.key}
                  data-tpl-field="body"
                  rows={4}
                  maxLength={MSG_BODY_MAX}
                  value={tpl.body}
                  onInput={(e) => patch(tpl.key, 'body', e.currentTarget.value)}
                />
              </div>
            </div>
          ))
          : null}
      </div>
      <button
        type="button"
        class="primary-btn full-width"
        disabled={busy || state.status !== 'ready'}
        onClick={() => void saveAll()}
      >
        {t('inbox.admin.templates.save')}
      </button>
    </AdminOverlay>
  );
}
