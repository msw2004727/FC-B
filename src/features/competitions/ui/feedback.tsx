import type { JSX } from 'preact';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { CP_REASON_FALLBACK_KEY, cpReasonKey } from '../data/reasons';
import { toCpCallError } from '../data/cp-callables';
import { CpCard, CpFrame } from './shell';

export function reasonParams(params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out;
}

const GENERIC_FAILURE = '操作失敗，請稍後再試';

export function reasonText(
  t: (key: string, params?: Record<string, string | number>) => string,
  reason: string,
  params?: Record<string, unknown>,
): string {
  const key = cpReasonKey(reason);
  const text = t(key, reasonParams(params));
  // 翻譯缺漏時 useT 會回鍵名。未知 reason 一定是通用失敗文案，不露出代碼。
  if (!text || text === key || (reason !== '' && text === reason)) {
    const fallback = t(CP_REASON_FALLBACK_KEY);
    if (!fallback || fallback === CP_REASON_FALLBACK_KEY) return GENERIC_FAILURE;
    return fallback;
  }
  return text;
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

/** 登錄表單不符資格時：原因＋回名單頁。ENTRY_STATUS 不是伺服器代碼，不走 reasonText。 */
export function RosterBlocked({
  reason,
  cid,
  enId,
}: {
  reason: string;
  cid: string;
  enId: string;
}): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const href = `/competitions/${cid}/entries/${enId}`;
  return (
    <CpFrame title={t('competitions.rosterTitle')}>
      <CpCard>
        {reason === 'ENTRY_STATUS'
          ? <p class="cps-note cps-warn" role="alert">{t('competitions.rosterEntryClosed')}</p>
          : <CpError reason={reason} />}
        <p style="margin-top:12px">
          <a
            class="cps-link"
            href={href}
            onClick={(event) => {
              event.preventDefault();
              route(href);
            }}
          >
            {t('competitions.backToRoster')}
          </a>
        </p>
      </CpCard>
    </CpFrame>
  );
}
