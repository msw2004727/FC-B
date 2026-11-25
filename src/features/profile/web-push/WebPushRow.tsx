// 個人頁「推播」頁籤最上方的「手機／電腦通知」列（站長 2026-11-24 確認的預覽 `2026-11-24-webpush-toggle`）。
// DOM 與 class 照預覽：.wp-block > .line-notify-row.wp-row（＋提示列 .line-notify-hint.wp-hint）、下方 .wp-sep。
// 狀態機見設計書 §4：H 不畫、L1／L2 LINE 內、I iPhone 未加主畫面、C 讀取中、B 已封鎖、O 可開啟、S 送出中、N 已開啟。
// 讀取中用全站共用轉圈（ui-spin，站長同意的差異 1）；本列程式與字典到之前由 WebPushSlot 先放等高空白（差異 2）。
// 開通前只有 QA 帳號看得到（顧問 §3.699 Q5，WEB_PUSH_UI_PUBLIC）。
// 2026-11-25 站長選定預覽 `2026-11-25-push-card` 的 C 案（橫幅提示卡），取代 W5 的一般列外觀：
// 未開啟（含讀取中、送出中、已封鎖、LINE 內、iPhone 未加主畫面）是漸層橫幅（.wp-c.is-banner），已開啟收成一般卡片（.wp-c）。
// 列與提示列的 DOM／class 不變，只在 .wp-block 前面多一個鈴鐺圖示（.wp-c-icon），版面由 web-push.css 排。

import './web-push.css';
import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getReadyLiff } from '@/data/liff-init';
import type { PwaModalStep } from '@/features/pwa/PwaModals';
import { useQaSession } from '@/features/qa-login/data/qa-session';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { WebPushEnv } from './env';
import {
  disableWebPush,
  enableWebPush,
  readWebPushLocalState,
  syncWebPushOnBoot,
  webPushDeps,
  type DisableResult,
  type EnableResult,
} from './flows';
import { useWebPushT, type WebPushT } from './i18n';

// 既有 iPhone 安裝教學彈窗（PwaModals）由側邊選單分塊取得：直接 import 會把它拆成新的共用分塊，改到首頁主程式。
const PwaModals = lazy(() => import('@/ui/SideDrawer').then((m) => ({ default: m.PwaModals })));

type View =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'blocked' }
  | { kind: 'sending'; target: boolean };

/** 上方間距＋橫幅高度＋下方間距（與 web-push.css 的 .wp-c、.wp-c.is-banner、.wp-sep 一致；WebPushSlot 的佔位同值）。 */
const PLACEHOLDER_STYLE = 'min-height:calc(2.45rem + 44px + var(--space-2))';

/** 與列等高的空白：程式、字典或 QA 判斷還沒到時先佔位，下方 LINE 區不跳動。 */
export function WebPushPlaceholder(): JSX.Element {
  return <div class="wp-placeholder" style={PLACEHOLDER_STYLE} aria-hidden="true" />;
}

/** 在目前網址的 hash 前加 openExternalBrowser=1（同 open-external.ts 的寫法；那支在入口且未 export）。 */
export function withOpenExternalBrowser(href: string): string {
  const hashAt = href.indexOf('#');
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const joiner = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${joiner}openExternalBrowser=1${hash}`;
}

/** 「用 Chrome／Safari 開啟」：點擊當下同步執行，不先 await。Mini App 走 liff.openWindow。 */
export function openInExternalBrowser(): void {
  const href = location.href;
  try {
    const liff = getReadyLiff();
    if (liff && liff.isInClient()) {
      liff.openWindow({ url: href, external: true });
      return;
    }
  } catch {
    /* LIFF 不可用就走網址參數 */
  }
  location.assign(withOpenExternalBrowser(href));
}

function Bell({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 004 0" />
    </svg>
  );
}

function Toggle({ wt, checked, disabled, onToggle }: {
  wt: WebPushT;
  checked: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  return (
    <label class="toggle-switch">
      <input
        type="checkbox"
        aria-label={wt('webPush.label')}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span class="toggle-slider"></span>
    </label>
  );
}

function Hint({ text, button, warn, onClick }: {
  text: string;
  button?: string;
  warn?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <div class={`line-notify-hint wp-hint${warn ? ' warn' : ''}`}>
      <span>{text}</span>
      {button && (
        <button type="button" class="line-notify-friend-btn" onClick={onClick}>{button}</button>
      )}
    </div>
  );
}

export interface WebPushRowProps {
  uid: string;
  /** 由 WebPushSlot 同步判斷後傳入（本檔不 import env.ts：會讓個人頁分塊多出匯出、改到首頁主程式）。 */
  env: WebPushEnv;
  /** iPhone／iPad 主畫面 App：封鎖時顯示 iPhone 設定步驟。 */
  iosStandalone: boolean;
  /** env.ts 的 WEB_PUSH_UI_PUBLIC（由 WebPushSlot 傳入，同上理由）。false＝開通前只給 QA 帳號看。 */
  uiPublic: boolean;
}

export function WebPushRow({ uid, env, iosStandalone, uiPublic }: WebPushRowProps): JSX.Element | null {
  const t = useT();
  const wt = useWebPushT();
  const qa = useQaSession(uiPublic ? null : uid);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [pwaStep, setPwaStep] = useState<PwaModalStep>('none');
  const mountedRef = useRef(true);
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const checkSeq = useRef(0);
  const visible = uiPublic || !!qa;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 本機查（不讀資料庫）；查完前停在讀取中。uid 變了或後發先到時丟棄舊結果（L-43）。
  async function check(): Promise<void> {
    const seq = ++checkSeq.current;
    const forUid = uid;
    const deps = webPushDeps();
    const fresh = (): boolean => mountedRef.current && seq === checkSeq.current && uidRef.current === forUid;
    let next: View['kind'];
    try {
      let state = await readWebPushLocalState(forUid, deps);
      if (state === 'needs-sync') {
        // 本機紀錄與瀏覽器不一致（X1／X2）：背景收斂一次，畫面停在讀取中；仍不一致就回到可開啟。
        await syncWebPushOnBoot(forUid, deps);
        state = await readWebPushLocalState(forUid, deps);
      }
      next = state === 'needs-sync' ? 'off' : state;
    } catch {
      next = 'hidden';
    }
    if (fresh()) setView({ kind: next });
  }

  useEffect(() => {
    if (env !== 'capable' || !visible) return undefined;
    setView({ kind: 'loading' });
    check().catch(() => {});
    return () => {
      checkSeq.current += 1;
    };
    // check 讀的是目前 uid；只在 uid、可見性變動時重查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, env, visible]);

  // 已封鎖：使用者到瀏覽器設定改成允許、回到頁面時重查。
  useEffect(() => {
    if (view.kind !== 'blocked') return undefined;
    const recheck = (): void => {
      if (document.visibilityState === 'visible') check().catch(() => {});
    };
    document.addEventListener('visibilitychange', recheck);
    let status: PermissionStatus | null = null;
    let alive = true;
    const listen = async (): Promise<void> => {
      // 不支援 permissions.query 就只靠回前景。
      const s = await navigator.permissions?.query({ name: 'notifications' });
      if (!alive || !s) return;
      status = s;
      s.addEventListener('change', recheck);
    };
    listen().catch(() => {});
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', recheck);
      status?.removeEventListener('change', recheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  async function finishEnable(pending: Promise<EnableResult>, forUid: string): Promise<void> {
    const result = await pending;
    if (!mountedRef.current) return;
    if (result === 'busy' || result === 'stale' || uidRef.current !== forUid) {
      await check();
      return;
    }
    if (result === 'on') {
      setView({ kind: 'on' });
      if (wt) toast.show({ message: wt('webPush.toastOn') });
    } else if (result === 'blocked') {
      setView({ kind: 'blocked' });
    } else if (result === 'dismissed') {
      setView({ kind: 'off' });
    } else {
      setView({ kind: 'off' });
      if (wt) toast.show({ message: wt('webPush.toastFailed'), tone: 'error' });
    }
  }

  async function finishDisable(pending: Promise<DisableResult>): Promise<void> {
    const result = await pending;
    if (!mountedRef.current) return;
    if (result === 'busy') {
      await check();
      return;
    }
    setView({ kind: 'off' });
    if (wt) toast.show({ message: wt('webPush.toastOff') });
  }

  // 同步處理：enableWebPush 在回傳前就呼叫 requestPermission（手勢當下），之後才 await。
  function handleToggle(): void {
    if (view.kind === 'off') {
      const pending = enableWebPush(uid);
      setView({ kind: 'sending', target: true });
      finishEnable(pending, uid).catch(() => {});
    } else if (view.kind === 'on') {
      const pending = disableWebPush();
      setView({ kind: 'sending', target: false });
      finishDisable(pending).catch(() => {});
    }
  }

  if (env === 'unsupported') return null;
  // 開通前 QA 判斷還沒出來：直接不畫（一般使用者不會看到空白一閃再收掉）；開通後才先放等高空白。
  if (qa === undefined) return uiPublic ? <WebPushPlaceholder /> : null;
  if (!wt) return <WebPushPlaceholder />;
  if (!visible) return null;
  if (env === 'capable' && view.kind === 'hidden') return null;

  let right: JSX.Element | null = null;
  let hint: JSX.Element | null = null;
  if (env === 'line-android' || env === 'line-ios') {
    hint = (
      <Hint
        text={wt('webPush.inLine')}
        button={wt(env === 'line-ios' ? 'webPush.openSafari' : 'webPush.openChrome')}
        onClick={openInExternalBrowser}
      />
    );
  } else if (env === 'ios-home') {
    hint = <Hint text={wt('webPush.iosHome')} button={wt('webPush.howToAdd')} onClick={() => setPwaStep('ios')} />;
  } else if (view.kind === 'loading') {
    right = (
      <span class="wp-spin" role="status" aria-label={t('common.loading')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
          <path d="M12 3a9 9 0 1 1-9 9" />
        </svg>
      </span>
    );
  } else if (view.kind === 'blocked') {
    right = <span class="line-notify-status unbound">{wt('webPush.blocked')}</span>;
    hint = <Hint text={wt(iosStandalone ? 'webPush.blockedStepIos' : 'webPush.blockedStep')} warn />;
  } else if (view.kind === 'sending') {
    right = <Toggle wt={wt} checked={view.target} disabled />;
  } else {
    right = <Toggle wt={wt} checked={view.kind === 'on'} onToggle={handleToggle} />;
  }

  // 已開啟（含關閉送出中）收成一般卡片；其餘狀態都是橫幅。
  const banner = !(env === 'capable' && (view.kind === 'on' || (view.kind === 'sending' && !view.target)));

  return (
    <>
      <div class={`wp-block wp-c${banner ? ' is-banner' : ''}`} data-wp-state={env === 'capable' ? view.kind : env}>
        <span class="wp-c-icon" aria-hidden="true"><Bell size={banner ? 24 : 18} /></span>
        <div class="line-notify-row wp-row">
          <span>
            {wt('webPush.label')}
            <span class="line-notify-sub">{wt('webPush.scope')}</span>
          </span>
          {right}
        </div>
        {hint}
      </div>
      <div class="wp-sep"></div>
      {pwaStep !== 'none' && (
        <Suspense fallback={null}>
          <PwaModals step={pwaStep} onChangeStep={setPwaStep} />
        </Suspense>
      )}
    </>
  );
}

export default WebPushRow;
