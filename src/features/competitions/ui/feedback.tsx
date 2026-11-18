import type { JSX } from 'preact';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { cpReasonKey } from '../data/reasons';
import { toCpCallError } from '../data/cp-callables';

export function reasonParams(params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out;
}

export function reasonText(
  t: (key: string, params?: Record<string, string | number>) => string,
  reason: string,
  params?: Record<string, unknown>,
): string {
  return t(cpReasonKey(reason), reasonParams(params));
}

export function errorOf(err: unknown): { reason: string; params: Record<string, unknown> } {
  const cp = toCpCallError(err);
  return { reason: cp.reason, params: cp.params };
}

/** 只顯示文案，不顯示 reason 代碼。缺生日時附上個人資料連結。 */
export function CpError({
  reason,
  params,
}: {
  reason: string;
  params?: Record<string, unknown>;
}): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const text = reasonText(t, reason, params);
  if (reason === 'BIRTHDAY_REQUIRED') {
    return (
      <p class="cps-note cps-warn" role="alert">
        <span class="cps-nowrap">{text}</span>
        {' '}
        <a
          class="cps-link"
          href="/profile"
          onClick={(event) => {
            event.preventDefault();
            route('/profile');
          }}
        >
          {t('competitions.goBirthday')}
        </a>
      </p>
    );
  }
  return <p class="cps-note cps-warn" role="alert">{text}</p>;
}
