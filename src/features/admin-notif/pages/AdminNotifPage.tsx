import './admin-notif.css';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { ActionRingButton, useActionRingControl } from '@/ui/action-ring';
import { EmptyState } from '@/ui/EmptyState';
import { toast } from '@/ui/Toast';

import {
  canEnterNotifSettings,
  canToggleNotifSettings,
  loadNotifToggles,
  NOTIF_CATEGORY_KEYS,
  NOTIF_TYPE_KEYS,
  saveNotifToggles,
  type NotifToggleKey,
  type NotifToggles,
} from '../data/notif-toggles';

/** A `NOTIF_ALWAYS_ON_FIELDS` 的四列（只顯示「固定」，不可切換）。 */
const FIXED_ROWS = [
  'fixed_waitlist_promoted',
  'fixed_event_cancelled',
  'fixed_event_changed',
  'fixed_broadcast',
] as const;

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; values: NotifToggles };

/**
 * 載入完成前不顯示可儲存的表單；讀取失敗只給「重新載入」（照 A：避免用預設值覆寫既有開關）。
 * 沒有 admin.notif.toggle 時開關不可切換、不出現「儲存」（顯示與寫入同一判斷，R-IAM-011）。
 */
function NotifSettingsPanel({ viewer }: { viewer: ViewerView }): JSX.Element {
  const t = useT();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [loadSeq, setLoadSeq] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const ring = useActionRingControl();
  const canToggle = canToggleNotifSettings(viewer);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    loadNotifToggles()
      .then((values) => {
        if (alive) setLoad({ status: 'ready', values });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[NotifSettings] load failed:', err);
        if (alive) setLoad({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [loadSeq]);

  if (load.status === 'loading') {
    return <div class="notif-state" role="status">{t('admin-notif.loading')}</div>;
  }
  if (load.status === 'error') {
    return (
      <div class="notif-state" role="alert">
        <div>{t('admin-notif.loadError')}</div>
        <button type="button" class="outline-btn" style="margin-top:.65rem" onClick={() => setLoadSeq((n) => n + 1)}>
          {t('admin-notif.retry')}
        </button>
      </div>
    );
  }

  const values = load.values;

  function setValue(key: NotifToggleKey, checked: boolean): void {
    if (!canToggle || savingRef.current) return;
    setLoad({ status: 'ready', values: { ...values, [key]: checked } });
  }

  async function handleSave(): Promise<void> {
    if (savingRef.current) return;
    if (!canToggle) {
      toast.show({ message: t('admin-notif.noPermission'), tone: 'error' });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    ring.start();
    try {
      await saveNotifToggles(values, viewer);
      const mounted = await ring.succeed();
      if (mounted && mountedRef.current) toast.show({ message: t('admin-notif.saved'), tone: 'success' });
    } catch (err) {
      ring.fail();
      // eslint-disable-next-line no-console
      console.error('[NotifSettings] save failed:', err);
      if (mountedRef.current) toast.show({ message: t('admin-notif.saveFailed'), tone: 'error' });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function toggleRow(key: NotifToggleKey): JSX.Element {
    const label = t(`admin-notif.row.${key}`);
    return (
      <div class="notif-row" key={key} data-notif-row={key}>
        <span class="notif-label">{label}</span>
        <label class="toggle-switch">
          <input
            type="checkbox"
            data-notif-toggle-key={key}
            aria-label={label}
            checked={values[key]}
            disabled={!canToggle || saving}
            onChange={(e) => {
              const input = e.currentTarget;
              // 受控 checkbox 被擋下時 Preact 不會把 DOM 勾選改回來，要手動設回（T-013）。
              if (!canToggle || savingRef.current) {
                input.checked = values[key];
                return;
              }
              setValue(key, input.checked);
            }}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    );
  }

  return (
    <>
      <div class="notif-note">{t('admin-notif.note')}</div>
      <div class="notif-sec">{t('admin-notif.sectionCategory')}</div>
      <div class="notif-card">{NOTIF_CATEGORY_KEYS.map(toggleRow)}</div>
      <div class="notif-sec">{t('admin-notif.sectionType')}</div>
      <div class="notif-card">{NOTIF_TYPE_KEYS.map(toggleRow)}</div>
      <div class="notif-sec">{t('admin-notif.sectionFixed')}</div>
      <div class="notif-card">
        {FIXED_ROWS.map((key) => (
          <div class="notif-row" key={key} data-notif-fixed={key}>
            <span class="notif-label">{t(`admin-notif.row.${key}`)}</span>
            <span class="notif-fixed">{t('admin-notif.fixed')}</span>
          </div>
        ))}
      </div>
      {canToggle ? (
        <ActionRingButton
          type="button"
          class="primary-btn full-width notif-save"
          id="notif-settings-save-btn"
          control={ring}
          busyLabel={t('admin-notif.saving')}
          disabled={saving}
          onClick={() => {
            handleSave().catch(() => {});
          }}
        >
          {saving ? t('admin-notif.saving') : t('admin-notif.save')}
        </ActionRingButton>
      ) : null}
    </>
  );
}

/** 後台「推播通知設定」（路由 `/admin/notif`）。入口與頁面同一判斷：`admin.notif.entry`（照 A DRAWER_MENUS）。 */
export default function AdminNotifPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const goBack = useGoBack('/');
  const waiting = !viewer.uid ? getLastKnownAuthUid() !== null : !isViewerPermissionsLoaded(viewer);
  const canEnter = !waiting && canEnterNotifSettings(viewer);

  let body: JSX.Element;
  if (waiting) {
    body = <div class="notif-state" role="status">{t('admin-notif.loading')}</div>;
  } else if (!canEnter) {
    body = <EmptyState title={t('admin-notif.noPermission')} />;
  } else {
    body = <NotifSettingsPanel viewer={viewer} />;
  }

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-notif">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label={t('admin-notif.back')} onClick={goBack}>
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <h2>{t('admin-notif.title')}</h2>
        </div>
        {body}
      </section>
    </div>
  );
}
