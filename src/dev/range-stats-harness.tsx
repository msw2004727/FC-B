// 活動區間統計彈窗：正式元件＋假讀取層截圖（vite.range-stats.config.ts 把讀取層換成 range-stats-fakes）。
// ?theme=light|dark、?noshow=0。畫完設 window.__CPS_READY。
import { render } from 'preact';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
// 與 main.tsx 相同的 A 全域樣式，加上活動管理頁自己載入的 activity.css（A 按鈕等）。
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-line-height.css';
import '@/features/events/legacy/activity.css';
import type { ViewerView } from '@/features/profile/data/viewer';
import { RangeStatsModal } from '@/features/events/components/legacy/RangeStatsModal';

const params = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', params.get('theme') === 'dark' ? 'dark' : 'light');
const NOW = Date.UTC(2026, 10, 23, 4);
// 不匯入 viewer 模組（它會訂閱登入狀態、嘗試初始化 Firebase）；假讀取層也不看 viewer。
const viewer = { uid: 'harness', hasPermission: () => true } as unknown as ViewerView;

render(
  <div class="legacy-ui" style="min-height:100vh;background:var(--bg-root)">
    <RangeStatsModal
      open
      viewer={viewer}
      manageAll
      canViewNoShow={params.get('noshow') !== '0'}
      onClose={() => undefined}
      nowMs={NOW}
    />
  </div>,
  document.getElementById('app')!,
);
setTimeout(() => {
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
}, 300);
