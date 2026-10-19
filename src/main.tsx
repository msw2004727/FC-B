import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
// 舊版 A 的樣式（原檔照搬，打包時限定在 .legacy-ui 內，見 styles/legacy/README.md）
import './styles/legacy/base.css';
import './styles/legacy/layout.css';
import './styles/legacy-body-state.css';
import { App } from './app/App';
import { ErrorFallback } from './ui/ErrorFallback';
import { registerFeatures } from './core/feature-registry';
import { ALL_FEATURES } from './features.config';
import { initTheme } from './core/theme';
import { initLocale } from './i18n/i18n';

function renderBootError(root: HTMLElement): void {
  render(<ErrorFallback fixed onRetry={() => location.reload()} />, root);
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    console.error('[boot] #app 不存在');
    return;
  }

  try {
    registerFeatures(ALL_FEATURES);
  } catch (err) {
    console.error('[boot] 功能註冊失敗', err);
    renderBootError(root);
    return;
  }

  try {
    initTheme();
  } catch (err) {
    // 主題失敗只影響配色，記錄後繼續啟動（依 A1：只有註冊表錯誤或 render 例外才顯示啟動錯誤）
    console.error('[boot] 主題初始化失敗', err);
  }

  try {
    await initLocale();
  } catch (err) {
    // 字典空時 t() 回傳 key 是可接受的降級；仍要掛載 App。
    console.error('[boot] 語系初始化失敗', err);
  }

  try {
    render(<App />, root);
  } catch (err) {
    console.error('[boot] 首次 render 失敗', err);
    renderBootError(root);
  }
}

void boot();
