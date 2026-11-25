// 加到主畫面浮球截圖台：正式元件（BottomNav、ContactOwnerFab、PwaInstallFab、PwaModals）＋假首頁背景。
// 不連 Firestore、不呼叫 Functions；截圖腳本另擋所有非本機請求。
// ?theme=light|dark ?lang= ?hint=contact|pwa（顯示哪個提示泡泡）?modal=picker|ios|android ?update=1（有新版本提示）?toast=文字
import { render } from 'preact';
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
import { setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { ToastHost } from '@/ui/ToastHost';
import { BottomNav } from '@/ui/BottomNav';
import { ContactOwnerFab } from '@/features/home/components/ContactOwnerFab';
import { PwaInstallFab, showPwaFabHint } from '@/features/home/components/PwaInstallFab';
import { PwaModals, type PwaModalStep } from '@/features/pwa/PwaModals';
import { showSwReloadPrompt } from '@/core/reload-safety';
import { toast } from '@/ui/Toast';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const lang = (params.get('lang') || 'zh-TW') as Locale;
const hint = params.get('hint') || '';
const modal = params.get('modal') || '';
document.documentElement.setAttribute('data-theme', theme);

function Card({ title, sub }: { title: string; sub: string }): preact.JSX.Element {
  return (
    <div style="display:flex;gap:.7rem;align-items:center;padding:.7rem;margin:0 .9rem .6rem;background:var(--bg-card);border:1px solid var(--border);border-radius:12px">
      <div style="width:56px;height:56px;border-radius:10px;background:var(--bg-elevated, var(--border));flex:none" />
      <div style="min-width:0">
        <div style="font-weight:700;font-size:.92rem;color:var(--text-primary)">{title}</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.2rem">{sub}</div>
      </div>
    </div>
  );
}

function App(): preact.JSX.Element {
  const step = (modal || 'none') as PwaModalStep;
  return (
    <LocationProvider>
      <div class="legacy-ui" style="min-height:100vh;background:var(--bg-root);padding-top:12px;padding-bottom:120px;max-width:640px;margin:0 auto">
        <div style="margin:0 .9rem .9rem;height:150px;border-radius:14px;background:linear-gradient(135deg,var(--primary),var(--accent));opacity:.85" />
        <div style="margin:0 .9rem .5rem;font-weight:800;color:var(--text-primary)">近期活動（假資料）</div>
        <Card title="週三晚上羽球團" sub="11/26（三）19:00・大安運動中心" />
        <Card title="週末足球友誼賽" sub="11/29（六）09:00・百齡河濱" />
        <Card title="新手籃球練習" sub="11/30（日）14:00・中正運動中心" />
        <Card title="平日桌球交流" sub="12/02（二）20:00・信義運動中心" />
        <Card title="慢跑同好會" sub="12/03（三）06:30・大佳河濱" />
        {params.get('ads') === '1' ? (
          <div class="floating-ads" style="animation:none">
            <div class="float-ad" style="animation:none"><div class="float-ad-img">AD</div></div>
            <div class="float-ad" style="animation:none"><div class="float-ad-img">AD</div></div>
          </div>
        ) : null}
        <ContactOwnerFab onClick={() => undefined} />
        <PwaInstallFab />
        <BottomNav />
        <PwaModals step={step} onChangeStep={() => undefined} />
      </div>
      <ToastHost label="通知" />
    </LocationProvider>
  );
}

async function main(): Promise<void> {
  await setLocale(lang);
  render(<App />, document.getElementById('app')!);
  if (params.get('update') === '1') showSwReloadPrompt(() => undefined);
  if (params.get('toast')) toast.show({ message: params.get('toast')! });
  if (hint === 'pwa') {
    await new Promise((r) => setTimeout(r, 50));
    showPwaFabHint();
  }
  if (hint === 'contact') {
    const m = await import('@/features/home/components/contact-fab-hint');
    await new Promise((r) => setTimeout(r, 50));
    m.showContactFabHint();
  }
  (window as unknown as { __PF_READY: boolean }).__PF_READY = true;
}

main().catch((err: unknown) => {
  console.error(err);
});
