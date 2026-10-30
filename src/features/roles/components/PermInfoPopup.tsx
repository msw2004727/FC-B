import { useT } from '@/i18n/i18n';
import { RolesDialog } from './RolesDialog';

export function PermInfoPopup({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  return <RolesDialog title={t('roles.info.' + code + '.title')} onClose={onClose}
    footer={<button type="button" class="primary-btn full-width" onClick={onClose}>{t('roles.ui.understood')}</button>}>
    <div style="white-space:pre-line">{t('roles.info.' + code + '.body')}</div>
  </RolesDialog>;
}
