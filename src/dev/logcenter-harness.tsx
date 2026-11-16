// 日誌中心「聊天室稽核」截圖用元件 harness（只在本機 vite dev 開 /dev-harness/logcenter.html；正式 build 不含）。
// 全部假資料：Callable 走 VITE_CALLABLE_MODE=mock 的 registerMock，暱稱查詢注入假函式，不連 Firestore、不呼叫 Functions。
// 參數：?tab=op|chat&scene=list|convo|actor|target|settings|expired|finder|threads|all|opopen|opactor|day|month&size=10|20|30|infinite&theme=light|dark&lang=<語系>
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-body-state.css';
import '../styles/legacy-input-zoom.css';
import '../styles/legacy-line-height.css';
import '../styles/legacy/admin-logs.css';
import '../features/logs/legacy/admin-log-tabs.css';
import { registerMock } from '@/data/callables';

// harness 假資料不逐欄符合 Callable 回應型別（只給畫面用）。
const mock = registerMock as unknown as (name: string, handler: (req: Record<string, unknown>) => unknown) => void;
import { setLocale, t } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { ToastHost } from '@/ui/ToastHost';
import { OperationLogPanel } from '@/features/logs/components/OperationLogPanel';
import { PmAuditPanel } from '@/features/logs/components/PmAuditPanel';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') || 'list';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const locale = (params.get('lang') || 'zh-TW') as Locale;
document.documentElement.setAttribute('data-theme', theme);

// 假 UID（格式同 LINE userId：U＋32 位十六進位），全部虛構。
const U = (n: number): string => `U${String(n).padStart(4, '0')}a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`.slice(0, 33);
const ADMIN = U(1);
const A = U(2);
const B = U(3);
const C = U(4);
const D = U(5);
const NAMES: Record<string, string> = { [ADMIN]: '站長', [A]: '王小明', [B]: '陳大華', [C]: '林美玲（羽球週三團）', [D]: '' };
const cid = (x: string, y: string): string => [x, y].sort().join('__');

const BASE = Date.parse('2026-11-16T12:31:00Z');
let n = 0;
const log = (action: string, actorUid: string, targetUid = '', conversationId = '') => {
  n += 1;
  const ms = BASE - n * 7 * 60 * 1000;
  return { id: `pmlog_${ms}_${n}`, action, actorUid, targetUid, conversationId, createdAtIso: new Date(ms).toISOString(), createdAt: { _seconds: ms / 1000 } };
};
const ALL_LOGS = [
  log('audit_search_logs', ADMIN),
  log('send', A, B, cid(A, B)),
  log('read', B, A, cid(A, B)),
  log('audit_view_conversation', ADMIN, `${A},${C}`, cid(A, C)),
  log('send', C, A, cid(A, C)),
  log('recall', A, C, cid(A, C)),
  log('settings_view', ADMIN),
  log('edit', B, A, cid(A, B)),
  log('send', D, B, cid(B, D)),
  log('search_user', ADMIN),
  log('send', A, B, cid(A, B)),
  log('audit_view_thread', ADMIN, A),
];

// 多補幾天的私訊紀錄，示範分頁與時間區間。
const MORE_LOGS = Array.from({ length: 36 }, (_, i) => {
  const pairs: [string, string][] = [[A, B], [B, A], [C, A], [A, C], [D, B]];
  const [x, y] = pairs[i % pairs.length]!;
  return log(i % 4 === 3 ? 'read' : 'send', x, y, cid(x, y));
}).map((l, i) => {
  const ms = BASE - (2 + i * 4) * 60 * 60 * 1000;
  return { ...l, createdAtIso: new Date(ms).toISOString(), createdAt: { _seconds: ms / 1000 } };
});

const MSG = (id: string, fromUid: string, body: string, minsAgo: number, status = 'active') => ({
  id, fromUid, body, status, senderName: NAMES[fromUid] || '', createdAt: { _seconds: (BASE - minsAgo * 60000) / 1000 },
});

mock('getPmAuditLogs', async (req: Record<string, unknown>) => {
  let logs = [...ALL_LOGS, ...MORE_LOGS];
  if (req['actorUid']) logs = logs.filter((l) => l.actorUid === req['actorUid']);
  if (req['targetUid']) logs = logs.filter((l) => l.targetUid === req['targetUid']);
  if (req['action']) logs = logs.filter((l) => l.action === req['action']);
  const cursor = Number(req['cursorCreatedAtMs'] || 0);
  if (cursor) logs = logs.filter((l) => l.createdAt._seconds * 1000 < cursor);
  const limit = Number(req['limit'] || 50);
  const page = logs.slice(0, limit);
  const more = logs.length > limit;
  return { ok: true, logs: page, nextCursor: more ? { createdAtMs: page[page.length - 1]!.createdAt._seconds * 1000 } : null, hasMore: more };
});
mock('getPmAuditConversation', async () => {
  if (scene === 'expired') throw Object.assign(new Error('conversation not found'), { code: 'functions/not-found' });
  return {
    ok: true,
    thread: { id: cid(A, B), participants: [A, B], participantNames: { [A]: NAMES[A], [B]: NAMES[B] } },
    messages: [
      MSG('m1', A, '週三晚上的羽球還有位子嗎？', 95),
      MSG('m2', B, '有喔，剩兩個名額，要幫你朋友一起報嗎？', 90),
      MSG('m3', A, '好，麻煩幫我保留一個', 80, 'edited'),
      MSG('m4', B, '', 60, 'recalled'),
      MSG('m5', B, '已經幫你留了，記得帶球拍', 45),
    ],
  };
});
mock('getPrivateMessageSettings', async () => ({ ok: true, settings: { allowUserToUserPm: false } }));
mock('updatePrivateMessageSettings', async (req: Record<string, unknown>) => ({ ok: true, settings: { allowUserToUserPm: req['allowUserToUserPm'] === true } }));
mock('searchPmAuditUsers', async () => ({
  ok: true,
  users: [{ uid: A, name: NAMES[A], pictureUrl: '', role: 'user' }, { uid: C, name: NAMES[C], pictureUrl: '', role: 'coach' }],
}));
mock('listPmAuditThreads', async () => ({
  ok: true,
  threads: [
    { id: cid(A, B), participants: [A, B], participantNames: { [A]: NAMES[A], [B]: NAMES[B] }, lastMessageBody: '已經幫你留了，記得帶球拍', lastMessageAt: { _seconds: (BASE - 45 * 60000) / 1000 } },
    { id: cid(A, C), participants: [A, C], participantNames: { [A]: NAMES[A], [C]: NAMES[C] }, lastMessageBody: '訊息已撤回', lastMessageAt: { _seconds: (BASE - 300 * 60000) / 1000 } },
  ],
}));

const TYPES: [string, string, string][] = [
  ['event_create', '建立活動', '建立「週三羽球夜」（11/19 19:00）'],
  ['event_edit', '編輯活動', '編輯「週六足球友誼賽」：人數上限 20 → 24'],
  ['manual_attendance', '手動簽到', '「週三羽球夜」補簽到 3 人'],
  ['team_member_remove', '移除成員', '「台北晨跑社」移除成員 1 人'],
  ['event_cancel', '取消活動', '取消「颱風天戶外籃球」（場地封閉，已通知 18 位報名者並退回候補名單）'],
  ['role', '角色變更', '設定教練權限'],
  ['ann_create', '建立公告', '建立公告「11 月場地調整」'],
];
const OPS = Array.from({ length: 46 }, (_, i) => {
  const [type, typeName, content] = TYPES[i % TYPES.length]!;
  const who = [A, B, C, ADMIN, D][i % 5]!;
  const ms = BASE - i * 3.3 * 60 * 60 * 1000;
  return {
    _docId: `op_${Math.round(ms)}_${i}`, id: `op_${Math.round(ms)}_${i}`, type, typeName, content,
    operator: NAMES[who] || '', actorUid: who, eventId: type.startsWith('event_') ? `ce_${Math.round(ms)}_demo` : '',
    createdAt: { seconds: Math.floor(ms / 1000), nanoseconds: 0 },
  };
});
const fakeOps = async (startMs: number, endMs: number) => ({
  docs: OPS.filter((o) => o.createdAt.seconds * 1000 >= startMs && o.createdAt.seconds * 1000 < endMs),
  truncated: false,
});
const NOW = Date.parse('2026-11-16T14:00:00Z');
const tab = params.get('tab') === 'op' ? 'op' : 'chat';
const pageSizeParam = params.get('size');

const fakeNames = async (uids: readonly string[]) => Object.fromEntries(uids.map((u) => [u, NAMES[u] ?? '']));

function click(sel: string, index = 0): void {
  const el = document.querySelectorAll<HTMLElement>(sel)[index];
  el?.click();
}

function Screen() {
  useEffect(() => {
    const later = (fn: () => void, ms: number) => window.setTimeout(fn, ms);
    if (scene === 'convo' || scene === 'expired') later(() => click('.pma-open'), 300);
    if (scene === 'actor') later(() => click('.pma-log-people .pma-person', 0), 300);
    if (scene === 'target') later(() => click('.pma-log-people .pma-person', 1), 300);
    if (scene === 'settings') later(() => click('.pma-toolbar .pma-icon-btn'), 300);
    if (scene === 'all') later(() => click('.pma-toggle'), 300);
    if (scene === 'opopen') later(() => click('.olc-row', 4), 300);
    if (scene === 'opactor') later(() => click('.olc-row .pma-person', 0), 300);
    if (scene === 'day') later(() => click('.lc-seg-btn', 0), 300);
    if (scene === 'month') later(() => click('.lc-seg-btn', 2), 300);
    if (pageSizeParam) later(() => {
      const sel = document.querySelector<HTMLSelectElement>('.lc-size');
      if (sel) { sel.value = pageSizeParam; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, 200);
    if (scene === 'finder' || scene === 'threads') {
      later(() => {
        const input = document.querySelector<HTMLInputElement>('#pm-audit-user-query');
        if (input) {
          input.value = '王';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        later(() => document.querySelector<HTMLFormElement>('.pma-search')?.requestSubmit(), 50);
        if (scene === 'threads') later(() => click('.pma-finder-panel .pma-row'), 300);
      }, 300);
    }
  }, []);
  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-logs">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label="back">
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <h2>{t('logs.centerTitle')}</h2>
        </div>
        <div class="tab-bar admin-log-tabs" role="tablist">
          <button type="button" role="tab" class={`tab${tab === 'op' ? ' active' : ''}`}>{t('logs.tabs.operation.title')}</button>
          <button type="button" role="tab" class={`tab${tab === 'chat' ? ' active' : ''}`}>{t('logs.tabs.chat.title')}</button>
        </div>
        <div class="admin-log-panels">
          <section class="admin-log-panel">
            {tab === 'op' ? <OperationLogPanel fetchRange={fakeOps} nowMs={NOW} /> : <PmAuditPanel resolveNames={fakeNames} nowMs={NOW} />}
          </section>
        </div>
      </section>
    </div>
  );
}

setLocale(locale)
  .then(() => {
    render(
      <>
        <Screen />
        <ToastHost />
      </>,
      document.getElementById('app')!,
    );
  })
  .catch((err: unknown) => {
    console.error('[logcenter-harness]', err);
  });
