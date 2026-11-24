// 推播頁籤裡「手機／電腦通知」列的位置（網頁推播 W5）。環境先同步判斷：不支援就什麼都不畫（連分隔線也不畫）；
// 其餘先放與列等高的空白，推播列程式按需載入到了再換上（首頁主程式 0 位元組）。
// 開通前（WEB_PUSH_UI_PUBLIC=false）不放空白：一般使用者看不到推播列，空白一閃再收掉就是跳動；跳動只留給 QA 帳號（審查 P2-2）。

import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { detectWebPushEnv, isIosStandaloneEnv, readWebPushEnvInput, WEB_PUSH_UI_PUBLIC } from '../../web-push/env';

// 分塊載入失敗時只是不畫這一列，不讓個人頁進錯誤畫面（LINE 區照常）。
const WebPushRow = lazy(() => import('../../web-push/WebPushRow').catch(() => ({ default: () => null })));

const PLACEHOLDER = <div class="wp-placeholder" style="min-height:calc(2.1rem + 1rem + 1px)" aria-hidden="true" />;

export function WebPushSlot({ uid }: { uid: string }): JSX.Element | null {
  const input = useMemo(() => readWebPushEnvInput(), []);
  const env = input ? detectWebPushEnv(input) : 'unsupported';
  if (env === 'unsupported' || !uid) return null;
  return (
    <Suspense fallback={WEB_PUSH_UI_PUBLIC ? PLACEHOLDER : null}>
      <WebPushRow uid={uid} env={env} iosStandalone={isIosStandaloneEnv(input)} uiPublic={WEB_PUSH_UI_PUBLIC} />
    </Suspense>
  );
}
