// 運動喜好截圖台：正式元件（SportPrefsModal、LegacyProfileInfoCard、LegacyLineNotifyCard＋WebPushRow、AppConfirm）＋假資料。
// 不讀資料庫：排行與功能開關由 _setSportPrefsDataForTest 注入；Callable 走 mock（vite.sport-fav.config.ts）；推播依賴由 _setWebPushDepsForTest 注入。
// 截圖腳本另擋所有非本機請求。?scene=grid|grid-locked|profile|push ?theme= ?lang= ?push=on|off ?flag=0（功能開關關）
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-body-state.css';
import '../styles/legacy-line-height.css';
import '@/ui/app-shell.css';
import '@/features/home/legacy/home.css';
import '@/features/events/legacy/activity.css';
import '@/features/profile/legacy/profile.css';
import '@/features/profile/legacy/profile-glass.css';
import { setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { ToastHost } from '@/ui/ToastHost';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ProfileQuickBar, type QuickItem } from '@/features/profile/components/legacy/ProfileQuickBar';
import { LegacyProfileInfoCard } from '@/features/profile/components/legacy/LegacyProfileCards';
import { LegacyLineNotifyCard } from '@/features/profile/components/legacy/LegacyLineNotifyCard';
import type { UserProfile } from '@/features/profile/data/profile-model';
import { _setWebPushDepsForTest } from '@/features/profile/web-push/flows';
import { WEB_PUSH_VAPID_KEY_ID } from '@/features/profile/web-push/config';
import { hash32, writeWebPushRecord, clearWebPushRecord } from '@/features/profile/web-push/store';
import { fakeWorld, trackedSub } from '@/features/profile/web-push/test-fakes';
import { SportPrefsModal } from '@/features/sport-prefs/SportPrefsModal';
import { _setSportPrefsDataForTest } from '@/features/sport-prefs/data';
import { registerSportPrefsMock } from '@/features/sport-prefs/callables';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') || 'grid';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const lang = (params.get('lang') || 'zh-TW') as Locale;
const pushState = params.get('push') || 'off';
document.documentElement.setAttribute('data-theme', theme);

/** 假熱門排行（siteConfig/sportRank.order 的樣子）。 */
const RANK = ['football', 'badminton', 'basketball', 'pickleball', 'volleyball', 'table_tennis', 'tennis', 'running', 'hiking',
  'dodgeball', 'baseball_softball', 'cycling', 'yoga', 'dance', 'martial_arts'];

const EP = 'https://fcm.googleapis.com/fcm/send/harness';
async function setupPush(): Promise<void> {
  clearWebPushRecord();
  const w = fakeWorld({ uid: 'harness-uid' });
  if (pushState === 'on') {
    w.state.permission = 'granted';
    trackedSub(w, EP);
    writeWebPushRecord({ v: 1, uidHash: await hash32('harness-uid'), endpointHash: await hash32(EP), keyId: WEB_PUSH_VAPID_KEY_ID, reportedAt: w.state.now });
  }
  w.deps.now = () => w.state.now;
  _setWebPushDepsForTest(w.deps);
}

let favState: string[] = scene === 'profile-empty' ? [] : ['football', 'badminton', 'volleyball'];
const saveDelayMs = Number(params.get('delay')) || 0;
registerSportPrefsMock(async (data) => {
  if (saveDelayMs > 0) await new Promise((r) => setTimeout(r, saveDelayMs));
  if (Array.isArray(data.addSports)) favState = [...favState, ...(data.addSports as string[]).filter((k) => !favState.includes(k))];
  if (typeof data.removeSport === 'string') favState = favState.filter((k) => k !== data.removeSport);
  return { ok: true, favSports: favState, newEventNotify: data.newEventNotify !== false };
});

const PROFILE: UserProfile = {
  uid: 'harness-uid', name: '小明', _docId: 'harness-uid', lastActive: null, displayName: '小明',
  gender: '男', birthday: '1994/05/12', region: '台北市', phone: '0912-345-678', sports: '羽球、慢跑',
  favSports: favState,
  lineNotify: { bound: true, boundAt: '2026/11/02 21:14', settings: { activity: true, system: true, tournament: false } },
} as unknown as UserProfile;

function FakeHome(): preact.JSX.Element {
  const card = (title: string, sub: string): preact.JSX.Element => (
    <div style="display:flex;gap:.7rem;align-items:center;padding:.7rem;margin:0 .9rem .6rem;background:var(--bg-card);border:1px solid var(--border);border-radius:12px">
      <div style="width:56px;height:56px;border-radius:10px;background:var(--bg-elevated);flex:none" />
      <div><div style="font-weight:700;font-size:.92rem;color:var(--text-primary)">{title}</div><div style="font-size:.78rem;color:var(--text-muted);margin-top:.2rem">{sub}</div></div>
    </div>
  );
  return (
    <div style="padding-top:12px;max-width:640px;margin:0 auto">
      <div style="margin:0 .9rem .9rem;height:150px;border-radius:14px;background:linear-gradient(135deg,var(--primary),var(--accent));opacity:.85" />
      {card('週三晚上羽球團', '11/26（三）19:00')}
      {card('週末足球友誼賽', '11/29（六）09:00')}
      {card('新手籃球練習', '11/30（日）14:00')}
    </div>
  );
}

function Modal(): preact.JSX.Element | null {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const owned = scene === 'grid-locked' ? ['football', 'badminton'] : [];
  return <SportPrefsModal uid="harness-uid" owned={owned} onClose={() => setOpen(false)} onSaved={() => undefined} />;
}

function Profile({ which }: { which: 'info' | 'line' }): preact.JSX.Element {
  const [profile, setProfile] = useState(PROFILE);
  const onSaved = (patch: Record<string, unknown>): void => setProfile((p) => ({ ...p, ...patch }));
  const filler = (): preact.JSX.Element => <div />;
  const items: QuickItem[] = [
    { key: 'reg', icon: 'reg', label: '報名', ariaLabel: '我的報名', badge: 2, render: filler },
    { key: 'info', icon: 'info', label: '資料', ariaLabel: '我的資料', render: () => <LegacyProfileInfoCard embedded uid="harness-uid" profile={profile} onSaved={onSaved} /> },
    { key: 'line', icon: 'bell', label: '推播', ariaLabel: 'LINE 推播', render: () => <LegacyLineNotifyCard embedded uid="harness-uid" profile={profile} onSaved={onSaved} /> },
    { key: 'host', icon: 'host', label: '開團', ariaLabel: '開團', render: filler },
    { key: 'mate', icon: 'mate', label: '夥伴', ariaLabel: '我的運動夥伴', render: filler },
  ];
  return (
    <main id="main-content" style="min-height:0">
      <section class="page active" id="page-profile" style="animation:none">
        <ProfileQuickBar items={items} groupLabel="個人設定" initialOpenKey={which} />
      </section>
    </main>
  );
}

function App(): preact.JSX.Element {
  const body = scene.startsWith('grid') ? <><FakeHome /><Modal /></>
    : scene === 'push' ? <Profile which="line" /> : <Profile which="info" />;
  return (
    <LocationProvider>
      <div class="legacy-ui" style="min-height:100vh;background:var(--bg-root)">
        {body}
        <ToastHost label="通知" />
        <AppConfirmHost />
      </div>
    </LocationProvider>
  );
}

async function main(): Promise<void> {
  _setSportPrefsDataForTest(RANK, params.get('flag') !== '0');
  await setLocale(lang);
  await setupPush();
  render(<App />, document.getElementById('app')!);
  (window as unknown as { __SF_READY: boolean }).__SF_READY = true;
}

main().catch((err: unknown) => { console.error(err); });
