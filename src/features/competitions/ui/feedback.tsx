import { toChildArray, type ComponentChildren, type JSX } from 'preact';
import { useLocation } from 'preact-iso';
import { Button } from '@/ui/Button';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { CP_REASON_FALLBACK_KEY, cpReasonKey } from '../data/reasons';
import { toCpCallError } from '../data/cp-callables';
import { CpCard, CpFrame, CpI18nPending, InfoIcon, LockIcon } from './shell';

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

/** 讀賽事失敗的兩種畫面：hidden＝Rules 拒絕（下架、草稿、內部期都一樣，不分辨）；error＝網路或其他錯誤。 */
export type CpLoadFail = 'hidden' | 'error';

/** 讀取錯誤碼只在這裡判斷。Firestore 讀取被 Rules 拒絕時 code 是 permission-denied。 */
export function loadFailOf(err: unknown): CpLoadFail {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return code === 'permission-denied' ? 'hidden' : 'error';
}

/** 讀不到賽事。hidden 只說不公開並給返回賽事列表，不放重試；error 顯示讀取失敗，有 onRetry 才放重試。 */
export function CpLoadFailed({
  title,
  fail,
  onRetry,
}: {
  title: string;
  fail: CpLoadFail;
  onRetry?: () => void;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (fail === 'hidden') {
    return (
      <CpFrame title={title}>
        <CpGate icon={<LockIcon />} text={ct('reason.COMPETITION_HIDDEN')} load="private">
          <Button variant="primary" onClick={() => route('/tournaments', true)}>{ct('backToTournaments')}</Button>
        </CpGate>
      </CpFrame>
    );
  }
  return (
    <CpFrame title={title}>
      <CpGate icon={<InfoIcon />} text={ct('loadFailed')}>
        {onRetry ? <Button variant="primary" onClick={onRetry}>{ct('retry')}</Button> : null}
      </CpGate>
    </CpFrame>
  );
}

/**
 * 「一句話＋回去的鈕」版面（新外觀第 1b 批卡 1b-7）：頁首正下方一張玻璃卡，內容靠左；圖示＋一句話＋按鈕列。
 * 按鈕列一顆時不佔整列寬、靠左；兩顆時等寬並排（取消性質放左邊，由呼叫端排）。沒有按鈕就不畫按鈕列。
 * 只管版面，不管流程；別頁（記分頁、建立賽事守門、接受邀請）之後也用它。
 */
export function CpGate({
  icon,
  text,
  load,
  children,
}: {
  icon: JSX.Element;
  text: string;
  /** 寫在那一句上的 data-cp-load（測試與示範頁靠它找）。 */
  load?: string;
  children?: ComponentChildren;
}): JSX.Element {
  const hasButtons = toChildArray(children).length > 0;
  return (
    <CpCard class="cps-gate">
      {icon}
      <p class="cps-gate__text" role="alert" data-cp-load={load}>{text}</p>
      {hasButtons ? <div class="cps-gate__btns">{children}</div> : null}
    </CpCard>
  );
}

/** 只顯示文案，不顯示 reason 代碼。缺生日時附上個人資料連結。 */
export function CpError({
  reason,
  params,
}: {
  reason: string;
  params?: Record<string, unknown>;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const text = reasonText(ct, reason, params);
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
            event.stopPropagation(); // 不讓 preact-iso LocationProvider 的全域連結攔截再推一筆歷史（11-20 預演：返回要按兩次）。
            route('/profile');
          }}
        >
          {ct('goBirthday')}
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
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const href = `/competitions/${cid}/entries/${enId}`;
  return (
    <CpFrame title={ct('rosterTitle')}>
      <CpCard>
        {reason === 'ENTRY_STATUS'
          ? <p class="cps-note cps-warn" role="alert">{ct('rosterEntryClosed')}</p>
          : <CpError reason={reason} />}
        <p style="margin-top:12px">
          <a
            class="cps-link"
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation(); // 不讓 preact-iso LocationProvider 的全域連結攔截再推一筆歷史（11-20 預演：返回要按兩次）。
              route(href);
            }}
          >
            {ct('backToRoster')}
          </a>
        </p>
      </CpCard>
    </CpFrame>
  );
}
