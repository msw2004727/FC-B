import '../qa-login.css';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { signOutQa } from '@/data/auth';
import { isQaPersonaKey, useQaSession } from '@/features/qa-login/data/qa-session';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

function bannerText(
  persona: string,
  translate: ReturnType<typeof useT>,
): string {
  if (persona === '') return translate('qa-login.banner.plain');
  const name = isQaPersonaKey(persona)
    ? translate(`qa-login.persona.${persona}`)
    : persona;
  return translate('qa-login.banner.label', { persona: name });
}

export function QaBanner({ uid }: { uid: string | null | undefined }): JSX.Element | null {
  const session = useQaSession(uid);
  const t = useT();
  const locale = getCurrentLocale();
  const { route } = useLocation();
  const bannerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const label = session != null ? bannerText(session.persona, t) : '';

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    const node = bannerRef.current;
    if (!node) {
      rootStyle.removeProperty('--qa-banner-h');
      rootStyle.removeProperty('--qa-topbar-safe');
      return undefined;
    }

    const apply = (): void => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      rootStyle.setProperty('--qa-banner-h', `${height}px`);
      rootStyle.setProperty('--qa-topbar-safe', '0px');
    };
    apply();

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => apply());
    observer?.observe(node);
    window.addEventListener('resize', apply);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
      rootStyle.removeProperty('--qa-banner-h');
      rootStyle.removeProperty('--qa-topbar-safe');
    };
  }, [session != null, label, locale]);

  async function signOut(): Promise<void> {
    if (pendingRef.current || uid == null) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const done = await signOutQa(uid);
      if (done) route('/');
    } catch {
      toast.show({ message: t('qa-login.signOutFailed') });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (session == null) return null;

  return (
    <div ref={bannerRef} class="qa-banner" role="status" aria-live="polite">
      <p class="qa-banner__label">
        <Text>{label}</Text>
      </p>
      <button
        type="button"
        class="qa-banner__logout"
        disabled={pending}
        aria-disabled={pending ? 'true' : undefined}
        onClick={() => {
          void signOut();
        }}
      >
        <Text>{t('qa-login.banner.signOut')}</Text>
      </button>
    </div>
  );
}
