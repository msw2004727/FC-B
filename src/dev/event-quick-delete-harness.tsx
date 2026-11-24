// 活動內頁封面快速刪除鈕（站長 11-24）：正式元件＋假資料截圖，不連 Firebase、不登入。
// ?theme=light|dark；?screen=before|after|cancel|noperm|confirm1|confirm2|cancelconfirm。畫完設 window.__CPS_READY。
// before＝現行（只有活動編輯）、after＝已結束活動的刪除鈕、cancel＝報名中活動的取消活動鈕、noperm＝沒有權限、
// confirm1／confirm2＝刪除的雙重確認兩步、cancelconfirm＝取消活動的確認（同「我的活動」）。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠> → /dev-harness/event-quick-delete.html
import { render } from 'preact';
import { initLocale, t } from '@/i18n/i18n';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-body-state.css';
import '../styles/legacy-input-zoom.css';
import '../styles/legacy-line-height.css';
import '@/ui/app-confirm.css';
import '@/features/events/legacy/activity.css';
import '@/features/events/legacy/tournament-td-img-placeholder.css';
import { EventDetailCover, type LegacyDetailEvent } from '@/features/events/components/legacy/EventDetailMainView';
import { DeleteEventConfirmDialog } from '@/features/events/components/legacy/DeleteEventConfirmDialog';
import { AppConfirmHost, appConfirm } from '@/ui/AppConfirm';
import { LIFECYCLE_MESSAGES } from '@/features/events/components/legacy/event-lifecycle-action';

const params = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', params.get('theme') === 'dark' ? 'dark' : 'light');
const screen = params.get('screen') ?? 'after';
const noop = (): void => undefined;

const EVENT: LegacyDetailEvent = {
  id: 'e1', title: '週三晚7-9三村公園踢球團', type: 'play', status: 'open',
  date: '2026/11/25 19:00~21:00', max: 20, current: 8, image: '/public/og.png',
};

function Page(): preact.JSX.Element {
  const canEdit = screen !== 'noperm';
  const quick = screen === 'before' || screen === 'noperm' ? null
    : screen === 'cancel' || screen === 'cancelconfirm' ? 'cancel' : 'delete';
  return (
    <div class="legacy-ui" id="main-content">
      <section class="page active" id="page-activity-detail">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label="返回">‹</button>
          <h2 class="page-title">{EVENT.title}</h2>
        </div>
        <EventDetailCover event={EVENT} canEdit={canEdit} onEdit={noop} quickAction={quick} onQuickAction={noop} />
        {screen === 'confirm2' && (
          <DeleteEventConfirmDialog title={String(EVENT.title)} busy={false} onCancel={noop} onConfirm={noop} />
        )}
      </section>
      <AppConfirmHost />
    </div>
  );
}

// 正式站由全域 load 監聽補 img-loaded（legacy base.css 的 img 預設 opacity:0）；harness 自己補。
document.addEventListener('load', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.classList.add('img-loaded');
}, true);

void (async () => {
  await initLocale();
  render(<Page />, document.getElementById('app') as HTMLElement);
  if (screen === 'confirm1') void appConfirm(t('events.manage.delete.confirmFirst'), { danger: true });
  if (screen === 'cancelconfirm') void appConfirm(LIFECYCLE_MESSAGES.cancel.confirm);
  await new Promise((r) => setTimeout(r, 300));
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
})();
