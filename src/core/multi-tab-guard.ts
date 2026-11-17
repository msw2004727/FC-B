// M-050：多分頁警告（照 A `js/modules/multi-tab-guard.js:14-89`）
// 使用 BroadcastChannel('toosterx-tab-guard') 偵測多分頁，顯示「我知道了／關閉其他分頁」。
// 視覺特效在 multi-tab-fx（動態 import）。載入失敗就維持這份舊外觀，不得讓提示框消失。

import { toast } from '@/ui/Toast';

let multiTabId: string | null = null;
let multiTabChannel: BroadcastChannel | null = null;
let multiTabOthers: Set<string> | null = null;
let multiTabWarningShown = false;
let multiTabDisabledShown = false;
let multiTabCloseTimer: ReturnType<typeof setTimeout> | null = null;
let multiTabCloseHintTimer: ReturnType<typeof setTimeout> | null = null;
let multiTabFxCleanup: (() => void) | undefined;

function dropMultiTabFx(): void {
  const fn = multiTabFxCleanup;
  multiTabFxCleanup = undefined;
  fn?.();
}

function dismissMultiTabWarning(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('multi-tab-warning');
  // 停用畫面與原提示框共用 id；一般流程不得把停用畫面關掉。
  if (el?.hasAttribute('data-multi-tab-disabled')) return;
  dropMultiTabFx();
  if (!el) return;
  const wrapper = el.parentElement;
  el.remove();
  if (wrapper && wrapper.dataset.multiTabWrapper === '1' && !wrapper.querySelector('.multi-tab-overlay')) {
    wrapper.remove();
  }
}

/** 強制移除所有多分頁提示（含停用畫面）；只給停用流程與測試重置使用。 */
function removeMultiTabWarningDom(): void {
  if (typeof document === 'undefined') return;
  dropMultiTabFx();
  document.querySelectorAll<HTMLElement>('#multi-tab-warning').forEach((el) => {
    const wrapper = el.parentElement;
    el.remove();
    if (wrapper && wrapper.dataset.multiTabWrapper === '1' && !wrapper.querySelector('.multi-tab-overlay')) {
      wrapper.remove();
    }
  });
}

function isMultiTabDisabled(): boolean {
  return (
    multiTabDisabledShown ||
    (typeof document !== 'undefined' &&
      document.querySelector('#multi-tab-warning[data-multi-tab-disabled]') !== null)
  );
}

function applyMultiTabFxToOverlay(overlay: HTMLElement): void {
  void import('./multi-tab-fx').then(
    (m) => {
      if (!overlay.isConnected) return;
      try {
        dropMultiTabFx();
        multiTabFxCleanup = m.applyMultiTabFx(overlay);
      } catch {
        overlay.style.opacity = '1';
      }
    },
    () => {
      if (overlay.isConnected) overlay.style.opacity = '1';
    },
  );
}

interface MultiTabOverlayContent {
  id: string;
  title: string;
  bodyHtml: string;
  actionsHtml: string;
}

function createMultiTabOverlay(content: MultiTabOverlayContent): {
  wrapper: HTMLDivElement;
  overlay: HTMLDivElement;
} {
  const wrapper = document.createElement('div');
  wrapper.className = 'legacy-ui';
  wrapper.dataset.multiTabWrapper = '1';
  const overlay = document.createElement('div');
  overlay.id = content.id;
  overlay.className = 'multi-tab-overlay';
  // 先藏起來。特效套上後才淡入；import 失敗則把 opacity 還原，舊外觀留著。
  overlay.style.opacity = '0';
  overlay.innerHTML =
    '<div class="multi-tab-modal">' +
      '<div class="multi-tab-title">' + content.title + '</div>' +
      '<div class="multi-tab-body">' + content.bodyHtml + '</div>' +
      '<div class="multi-tab-actions">' + content.actionsHtml + '</div>' +
    '</div>';
  wrapper.appendChild(overlay);
  document.body.appendChild(wrapper);
  applyMultiTabFxToOverlay(overlay);
  return { wrapper, overlay };
}

let reloadPage: () => void = () => window.location.reload();
/** 測試用：替換重新整理（jsdom 的 location.reload 不可攔截）。 */
export function _setReloadForTest(fn: () => void): void {
  reloadPage = fn;
}

function requestCloseOthers(): void {
  try {
    multiTabChannel?.postMessage({ type: 'close-others', tabId: multiTabId });
  } catch {
    /* ignore */
  }
  try {
    toast.show('已通知其他分頁，關不掉的會顯示停用');
  } catch {
    /* ignore */
  }
  dismissMultiTabWarning();
}

function showMultiTabDisabled(): void {
  if (multiTabDisabledShown) return;
  if (typeof document === 'undefined' || !document.body) return;
  if (document.querySelector('#multi-tab-warning[data-multi-tab-disabled]')) {
    multiTabDisabledShown = true;
    return;
  }
  // 先收掉原提示框，避免它的點擊處理器綁到稍後同 id 的停用按鈕。
  dismissMultiTabWarning();
  removeMultiTabWarningDom();
  multiTabDisabledShown = true;

  const { overlay } = createMultiTabOverlay({
    id: 'multi-tab-warning',
    title: '這個分頁已停用',
    bodyHtml: '你已在另一個分頁繼續使用',
    actionsHtml:
      '<button type="button" class="outline-btn" id="multi-tab-dismiss">改在這裡使用</button>' +
      '<button type="button" class="primary-btn" id="multi-tab-close">關閉這個分頁</button>',
  });
  overlay.dataset.multiTabDisabled = '1';

  const useBtn = overlay.querySelector('#multi-tab-dismiss');
  const closeBtn = overlay.querySelector('#multi-tab-close');
  useBtn?.addEventListener('click', () => {
    try {
      reloadPage();
    } catch {
      /* ignore */
    }
  });
  closeBtn?.addEventListener('click', () => {
    try {
      window.close();
    } catch {
      /* ignore */
    }
    // 停用畫面中的關閉按鈕一定會被瀏覽器拒絕；稍後確認是否真的關閉，沒有就顯示提示。
    if (overlay.querySelector('#multi-tab-close-hint')) return;
    if (multiTabCloseHintTimer !== null) return;
    multiTabCloseHintTimer = setTimeout(() => {
      multiTabCloseHintTimer = null;
      if (window.closed === true) return;
      const modal = overlay.querySelector('.multi-tab-modal');
      if (!modal) return;
      if (modal.querySelector('#multi-tab-close-hint')) return;
      const actions = modal.querySelector('.multi-tab-actions');
      if (!actions) return;
      const hint = document.createElement('div');
      hint.className = 'multi-tab-body';
      hint.id = 'multi-tab-close-hint';
      hint.setAttribute('role', 'status');
      hint.style.marginTop = '12px';
      hint.textContent = '瀏覽器不允許網頁自動關閉這個分頁，請直接關閉它';
      actions.insertAdjacentElement('afterend', hint);
    }, 200);
  });
}

function handleCloseRequest(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    window.close();
  } catch {
    /* ignore */
  }
  if (isMultiTabDisabled()) return;
  dismissMultiTabWarning();
  if (multiTabCloseTimer !== null) return;
  multiTabCloseTimer = setTimeout(() => {
    multiTabCloseTimer = null;
    if (window.closed === true) return;
    showMultiTabDisabled();
  }, 200);
}

export function showMultiTabWarning(): void {
  if (multiTabWarningShown) return;
  if (isMultiTabDisabled()) return;
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('multi-tab-warning')) return;
  multiTabWarningShown = true;

  createMultiTabOverlay({
    id: 'multi-tab-warning',
    title: '偵測到多個分頁開啟',
    bodyHtml:
      '為了穩定的登入與資料同步體驗，<br>' +
      '建議只保留一個分頁。' +
      '<div class="multi-tab-divider"></div>' +
      '點下方按鈕可請其他舊分頁自動關閉<br>' +
      '<span style="font-size:.78rem;color:var(--text-muted)">（手動開的分頁可能要自行關閉）</span>',
    actionsHtml:
      '<button type="button" class="outline-btn" id="multi-tab-dismiss">我知道了</button>' +
      '<button type="button" class="primary-btn" id="multi-tab-close">關閉其他分頁</button>',
  });

  const dismissBtn = document.getElementById('multi-tab-dismiss');
  const closeBtn = document.getElementById('multi-tab-close');
  dismissBtn?.addEventListener('click', () => {
    dismissMultiTabWarning();
  });
  closeBtn?.addEventListener('click', () => {
    requestCloseOthers();
  });
}

export function initMultiTabGuard(): () => void {
  if (typeof BroadcastChannel === 'undefined' || typeof window === 'undefined') {
    return () => undefined;
  }
  if (multiTabChannel) return () => undefined;

  try {
    multiTabId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    multiTabChannel = new BroadcastChannel('toosterx-tab-guard');
    multiTabOthers = new Set<string>();

    multiTabChannel.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; tabId?: string } | null;
      if (!data || !data.tabId || data.tabId === multiTabId) return;
      if (isMultiTabDisabled()) {
        if (data.type === 'close-others') handleCloseRequest();
        return;
      }
      if (data.type === 'ping') {
        try {
          multiTabChannel?.postMessage({ type: 'pong', tabId: multiTabId });
        } catch {
          /* ignore */
        }
        multiTabOthers?.add(data.tabId);
        showMultiTabWarning();
      } else if (data.type === 'pong') {
        multiTabOthers?.add(data.tabId);
        showMultiTabWarning();
      } else if (data.type === 'bye') {
        multiTabOthers?.delete(data.tabId);
      } else if (data.type === 'close-others') {
        handleCloseRequest();
      }
    };

    try {
      multiTabChannel.postMessage({ type: 'ping', tabId: multiTabId });
    } catch {
      /* ignore */
    }

    const handleBeforeUnload = (): void => {
      try {
        multiTabChannel?.postMessage({ type: 'bye', tabId: multiTabId });
        multiTabChannel?.close();
      } catch {
        /* ignore */
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (multiTabCloseTimer !== null) {
        clearTimeout(multiTabCloseTimer);
        multiTabCloseTimer = null;
      }
      if (multiTabCloseHintTimer !== null) {
        clearTimeout(multiTabCloseHintTimer);
        multiTabCloseHintTimer = null;
      }
      try {
        multiTabChannel?.close();
      } catch {
        /* ignore */
      }
      multiTabChannel = null;
    };
  } catch (err) {
    console.warn('[MultiTabGuard] init failed:', err);
    return () => undefined;
  }
}

export function _resetMultiTabGuardForTest(): void {
  if (multiTabCloseTimer !== null) {
    clearTimeout(multiTabCloseTimer);
    multiTabCloseTimer = null;
  }
  if (multiTabCloseHintTimer !== null) {
    clearTimeout(multiTabCloseHintTimer);
    multiTabCloseHintTimer = null;
  }
  try {
    multiTabChannel?.close();
  } catch {
    /* ignore */
  }
  multiTabId = null;
  multiTabChannel = null;
  multiTabOthers = null;
  multiTabWarningShown = false;
  multiTabDisabledShown = false;
  removeMultiTabWarningDom();
  if (typeof document !== 'undefined') {
    document.querySelectorAll('style[data-multi-tab-fx-instance]').forEach((node) => {
      node.remove();
    });
  }
}
