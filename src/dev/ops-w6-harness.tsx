// 營運儀表板 W6 截圖台：正式 OpsDashboardPage（含推播裝置卡）＋假資料。
// 不登入、不連 Firestore：viewer、ops-data、firebase 由 vite.ops-w6.config.ts 換成 src/dev/ops-w6-*-fake.ts。
// ?scene=full|empty、?theme=light|dark、?lang=。畫完設 window.__OPS_READY。
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
import { setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import OpsDashboardPage from '@/features/ops-dashboard/pages/OpsDashboardPage';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const lang = (params.get('lang') || 'zh-TW') as Locale;
document.documentElement.setAttribute('data-theme', theme);

function App(): preact.JSX.Element {
  return (
    <LocationProvider>
      <div class="ui-app-shell">
        <main class="app-main" style="padding-top:12px;padding-bottom:24px">
          <OpsDashboardPage />
        </main>
      </div>
    </LocationProvider>
  );
}

async function main(): Promise<void> {
  await setLocale(lang);
  render(<App />, document.getElementById('app')!);
  (window as unknown as { __OPS_READY: boolean }).__OPS_READY = true;
}

main().catch((err: unknown) => {
  console.error(err);
});
