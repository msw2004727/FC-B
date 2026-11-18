/**
 * 聊天室稽核：齒輪鈕＋私訊設定抽屜。設定在第一次打開抽屜時才讀
 * （後端每讀一次會寫一筆 settings_view，進頁籤不再自動讀）。
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { loadPmSettings, savePmSettings } from '../data/pm-audit';
import { PmAuditSettingsSheet, type SettingStatus } from './PmAuditSettingsSheet';

export function PmAuditSettingsControl(): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [allowPm, setAllowPm] = useState(false);
  const [status, setStatus] = useState<SettingStatus>('loading');
  const [busy, setBusy] = useState(true);
  const loadedRef = useRef(false);
  const savingRef = useRef(false);

  async function openSheet(): Promise<void> {
    setOpen(true);
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const allow = await loadPmSettings();
      setAllowPm(allow);
      setStatus(allow ? 'on' : 'off');
    } catch {
      loadedRef.current = false;
      setStatus('loadFailed');
    } finally {
      setBusy(false);
    }
  }

  async function save(next: boolean): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setAllowPm(next);
    setStatus('saving');
    try {
      const saved = await savePmSettings(next);
      setAllowPm(saved);
      setStatus(saved ? 'on' : 'off');
      toast.show({ message: t('logs.chat.settingSaved'), tone: 'success' });
    } catch {
      setAllowPm(!next);
      setStatus('saveFailed');
      toast.show({ message: t('logs.chat.settingSaveToastFailed'), tone: 'error' });
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        class="pma-icon-btn"
        aria-label={t('logs.chat.settingsTitle')}
        onClick={() => { openSheet().catch(() => undefined); }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
      <PmAuditSettingsSheet
        open={open}
        allowPm={allowPm}
        status={status}
        busy={busy}
        onToggle={(next) => { save(next).catch(() => undefined); }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
