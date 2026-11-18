/**
 * 聊天室稽核：私訊設定抽屜（齒輪鈕開啟）。開關與狀態文字照原設定卡；長說明拿掉（R-UI-026），
 * 狀態文字本身已說明開／關的效果。
 */
import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';
import { BottomSheet } from '@/ui/BottomSheet';

export type SettingStatus = 'loading' | 'on' | 'off' | 'loadFailed' | 'saving' | 'saveFailed';

export interface PmAuditSettingsSheetProps {
  open: boolean;
  allowPm: boolean;
  status: SettingStatus;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onClose: () => void;
}

export function PmAuditSettingsSheet(props: PmAuditSettingsSheetProps): JSX.Element | null {
  const t = useT();
  if (!props.open) return null;
  const text: Record<SettingStatus, string> = {
    loading: t('logs.chat.settingLoading'),
    on: t('logs.chat.settingOn'),
    off: t('logs.chat.settingOff'),
    loadFailed: t('logs.chat.settingLoadFailed'),
    saving: t('logs.chat.settingSaving'),
    saveFailed: t('logs.chat.settingSaveFailed'),
  };
  return (
    <BottomSheet open title={t('logs.chat.settingsTitle')} class="pma-sheet" busy={props.busy && props.status === 'saving'} onClose={props.onClose}>
      <div class="pma-setting">
        <span class="pma-setting-label">{t('logs.chat.settingTitle')}</span>
        <label class="pma-switch" aria-label={t('logs.chat.settingTitle')}>
          <input
            id="pm-user-pm-toggle"
            type="checkbox"
            checked={props.allowPm}
            disabled={props.busy}
            onChange={(e) => props.onToggle(e.currentTarget.checked)}
          />
          <span />
        </label>
      </div>
      <div id="pm-audit-settings-status" class="pma-note">{text[props.status]}</div>
    </BottomSheet>
  );
}
