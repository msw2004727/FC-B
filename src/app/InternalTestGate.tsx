import { EmptyState } from '@/ui/EmptyState';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export interface InternalTestGateProps {
  /** null＝未登入；false＝已登入但不在名單；undefined＝確認中。 */
  allowed: boolean | null | undefined;
  onLogin: () => void;
  loginPending: boolean;
}

/** 內測模式下，訪客與不在白名單的帳號只看到這一頁，不載入任何功能。 */
export function InternalTestGate({
  allowed,
  onLogin,
  loginPending,
}: InternalTestGateProps): preact.JSX.Element {
  const t = useT();
  const checking = allowed === undefined;
  const body = allowed === false ? t('internalTest.notInvited') : t('internalTest.body');

  return (
    <EmptyState
      class="internal-test-gate"
      icon={null}
      title={t('internalTest.title')}
      body={checking ? t('internalTest.checking') : body}
      action={(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center' }}>
          {allowed === null && (
            <Button onClick={onLogin} loading={loginPending}>{t('internalTest.login')}</Button>
          )}
          <a href="https://toosterx.com/" style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
            <Text>{t('internalTest.goOld')}</Text>
          </a>
        </div>
      )}
    />
  );
}
