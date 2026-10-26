import '../qa-login.css';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { signInWithQa } from '@/data/auth';
import { QA_PERSONA_KEYS, useQaSession } from '@/features/qa-login/data/qa-session';
import { useViewer } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Text } from '@/ui/Text';

const ERROR_ID = 'qa-login-error';

// Input 的 type 聯集沒有 password。元件會把 type 原樣寫進 DOM，這裡只放寬型別。
function passwordFieldType(revealed: boolean): 'text' {
  return revealed ? 'text' : ('password' as 'text');
}

function applyPasswordGuards(input: HTMLInputElement, failed: boolean): void {
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.removeAttribute('name');
  if (failed) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', ERROR_ID);
    return;
  }
  if (input.getAttribute('aria-invalid') === 'true') input.removeAttribute('aria-invalid');
  if (input.getAttribute('aria-describedby') === ERROR_ID) input.removeAttribute('aria-describedby');
}

export default function QaLoginPage(): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const passwordWrapRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const [password, setPassword] = useState('');
  const [persona, setPersona] = useState('captain');
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // 已用一般帳號登入（uid 有值、claims 確認不是 QA）時提示會切換帳號；QA 登入者、未登入、claims 讀取中都不提示。
  const viewer = useViewer();
  const qaSession = useQaSession(viewer.uid);
  const regularAccount = viewer.uid !== null && qaSession === null;
  const regularName = viewer.displayName?.trim() ?? '';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const existing = document.head.querySelector('meta[name="robots"]');
    if (existing instanceof HTMLMetaElement) {
      const previous = existing.getAttribute('content');
      existing.setAttribute('content', 'noindex');
      return () => {
        if (previous === null) existing.removeAttribute('content');
        else existing.setAttribute('content', previous);
      };
    }
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex');
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useLayoutEffect(() => {
    const input = passwordWrapRef.current?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) return;
    applyPasswordGuards(input, failed);
  }, [failed, revealed]);

  async function submit(): Promise<void> {
    if (pendingRef.current) return;
    if (password === '') {
      const input = passwordWrapRef.current?.querySelector('input');
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    if (persona === '') return;
    pendingRef.current = true;
    const value = password;
    const passwordInput = passwordWrapRef.current?.querySelector('input');
    if (passwordInput instanceof HTMLInputElement) passwordInput.value = '';
    setPassword('');
    setPending(true);
    setFailed(false);
    try {
      await signInWithQa(value, persona);
      if (mountedRef.current) route('/');
    } catch {
      if (mountedRef.current) setFailed(true);
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }

  const personaOptions = QA_PERSONA_KEYS.map((key) => ({
    value: key,
    label: t(`qa-login.persona.${key}`),
  }));

  return (
    <div class={failed ? 'qa-login qa-login--error' : 'qa-login'}>
      <Text as="h1" class="qa-login__title">{t('qa-login.title')}</Text>
      <Text as="p" class="qa-login__lede">{t('qa-login.lede')}</Text>
      <div role="status" aria-live="polite">
        {regularAccount && (
          <Text as="p" class="qa-login__notice">
            {regularName === ''
              ? t('qa-login.switchNoticeNoName')
              : t('qa-login.switchNotice', { name: regularName })}
          </Text>
        )}
      </div>
      <form
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="qa-login__field">
          <div class="qa-login__password" ref={passwordWrapRef}>
            <Input
              id="qa-password"
              label={t('qa-login.password.label')}
              type={passwordFieldType(revealed)}
              value={password}
              onValueChange={setPassword}
              placeholder={t('qa-login.password.placeholder')}
              autoComplete="off"
            />
            <button
              type="button"
              class="qa-login__password-toggle"
              aria-pressed={revealed}
              aria-label={revealed ? t('qa-login.password.hideLabel') : t('qa-login.password.showLabel')}
              onClick={() => setRevealed((current) => !current)}
            >
              <Text>{revealed ? t('qa-login.password.hide') : t('qa-login.password.show')}</Text>
            </button>
          </div>
          {failed && (
            <p id={ERROR_ID} class="qa-login__error" role="alert">
              <span class="qa-login__error-icon" aria-hidden="true">{'⚠\uFE0E'}</span>
              <Text>{t('qa-login.error')}</Text>
            </p>
          )}
        </div>
        <div class="qa-login__field">
          <Select
            id="qa-identity"
            label={t('qa-login.persona.label')}
            value={persona}
            options={personaOptions}
            onValueChange={setPersona}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          class="qa-login__submit"
          disabled={pending}
          loading={pending}
          loadingText={t('qa-login.submitting')}
        >
          {t('qa-login.submit')}
        </Button>
        <Text as="p" class="qa-login__notice">{t('qa-login.notice')}</Text>
        <Text as="p" class="qa-login__footnote">{t('qa-login.footnote')}</Text>
      </form>
    </div>
  );
}
