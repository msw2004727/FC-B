// 網頁推播 W5 截圖台：正式元件（ProfileQuickBar ＋ LegacyLineNotifyCard embedded ＋ WebPushRow）＋假瀏覽器推播物件。
// 不連 Firestore、不呼叫 Functions：推播 API 與 Callable 全部由 _setWebPushDepsForTest 注入，QA 判斷由
// vite.webpush-w5.config.ts 換成假模組。?scene=、?theme=light|dark、?lang=。畫完設 window.__WP_READY。
import { render } from 'preact';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-body-state.css';
import '../styles/legacy-line-height.css';
import '@/ui/app-shell.css';
import '@/features/events/legacy/activity.css';
import '@/features/profile/legacy/profile.css';
import '@/features/profile/legacy/profile-glass.css';
import { setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { ToastHost } from '@/ui/ToastHost';
import { ProfileQuickBar, type QuickItem } from '@/features/profile/components/legacy/ProfileQuickBar';
import { LegacyLineNotifyCard } from '@/features/profile/components/legacy/LegacyLineNotifyCard';
import type { UserProfile } from '@/features/profile/data/profile-model';
import { _setWebPushDepsForTest } from '@/features/profile/web-push/flows';
import { WEB_PUSH_VAPID_KEY_ID } from '@/features/profile/web-push/config';
import { hash32, writeWebPushRecord, clearWebPushRecord } from '@/features/profile/web-push/store';
import { fakeWorld, trackedSub } from '@/features/profile/web-push/test-fakes';
import { WebPushCallError } from '@/features/profile/web-push/wp-callables';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') || 'off';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const lang = (params.get('lang') || 'zh-TW') as Locale;
document.documentElement.setAttribute('data-theme', theme);

const EP = 'https://fcm.googleapis.com/fcm/send/harness';
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

async function setup(): Promise<void> {
  clearWebPushRecord();
  const w = fakeWorld({ uid: 'harness-uid' });
  const s = w.state;
  if (scene === 'loading') w.deps.getRegistration = never;
  if (scene === 'blocked' || scene === 'blocked-ios') s.permission = 'denied';
  if (['on', 'toast-on', 'toast-off', 'sending-off'].includes(scene)) {
    s.permission = 'granted';
    if (scene !== 'toast-on') {
      trackedSub(w, EP);
      writeWebPushRecord({ v: 1, uidHash: await hash32('harness-uid'), endpointHash: await hash32(EP), keyId: WEB_PUSH_VAPID_KEY_ID, reportedAt: s.now });
    }
  }
  if (scene === 'toast-on') s.answer = 'granted';
  if (scene === 'sending') w.deps.register = never;
  if (scene === 'toast-failed') s.registerError = new WebPushCallError('internal');
  w.deps.now = () => s.now;
  _setWebPushDepsForTest(w.deps);
}

const PROFILE_BOUND: UserProfile = {
  uid: 'harness-uid', name: '小明', _docId: 'harness-uid', lastActive: null, displayName: '小明',
  lineNotify: { bound: true, boundAt: '2026/11/02 21:14', settings: { activity: true, system: true, tournament: false } },
};
const PROFILE_UNBOUND: UserProfile = { ...PROFILE_BOUND, lineNotify: { bound: false, settings: {} } };

function App(): preact.JSX.Element {
  const profile = scene === 'off-unbound' ? PROFILE_UNBOUND : PROFILE_BOUND;
  const filler = (): preact.JSX.Element => <div />;
  const items: QuickItem[] = [
    { key: 'reg', icon: 'reg', label: '報名', ariaLabel: '我的報名', badge: 2, render: filler },
    { key: 'info', icon: 'info', label: '資料', ariaLabel: '我的資料', render: filler },
    {
      key: 'line', icon: 'bell', label: '推播', ariaLabel: 'LINE 推播', dot: scene !== 'off-unbound',
      render: () => <LegacyLineNotifyCard embedded uid="harness-uid" profile={profile} onSaved={() => undefined} />,
    },
    { key: 'host', icon: 'host', label: '開團', ariaLabel: '開團', render: filler },
    { key: 'mate', icon: 'mate', label: '夥伴', ariaLabel: '我的運動夥伴', render: filler },
    { key: 'apply', icon: 'apply', label: '申請', ariaLabel: '我的俱樂部申請', render: filler },
  ];
  return (
    <div class="legacy-ui" style="min-height:100vh;background:var(--bg-root)">
      <main id="main-content" style="min-height:0">
        <section class="page active" id="page-profile" style="animation:none">
          <ProfileQuickBar items={items} groupLabel="個人設定" />
        </section>
      </main>
      <ToastHost label="通知" />
    </div>
  );
}

async function main(): Promise<void> {
  await setLocale(lang);
  await setup();
  render(<App />, document.getElementById('app')!);
  (window as unknown as { __WP_SCENE: string }).__WP_SCENE = scene;
  (window as unknown as { __WP_READY: boolean }).__WP_READY = true;
}

main().catch((err: unknown) => {
  console.error(err);
});
