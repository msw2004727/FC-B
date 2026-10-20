// M-050：多分頁警告（照 A `js/modules/multi-tab-guard.js:14-89`）
// 使用 BroadcastChannel('toosterx-tab-guard') 偵測多分頁，顯示「我知道了／關閉其他分頁」。

let multiTabId: string | null = null;
let multiTabChannel: BroadcastChannel | null = null;
let multiTabOthers: Set<string> | null = null;
let multiTabWarningShown = false;

function dismissMultiTabWarning(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('multi-tab-warning');
  if (el) el.remove();
}

function requestCloseOthers(): void {
  try {
    multiTabChannel?.postMessage({ type: 'close-others', tabId: multiTabId });
  } catch {
    /* ignore */
  }
  dismissMultiTabWarning();
}

function handleCloseRequest(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    window.close();
  } catch {
    /* ignore */
  }
  // 若瀏覽器不允許自動 window.close()，顯示已關閉提示或關閉對話框
  dismissMultiTabWarning();
}

export function showMultiTabWarning(): void {
  if (multiTabWarningShown) return;
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('multi-tab-warning')) return;
  multiTabWarningShown = true;

  const wrapper = document.createElement('div');
  wrapper.className = 'legacy-ui';
  const overlay = document.createElement('div');
  overlay.id = 'multi-tab-warning';
  overlay.className = 'multi-tab-overlay';
  overlay.innerHTML =
    '<div class="multi-tab-modal">' +
      '<div class="multi-tab-title">偵測到多個分頁開啟</div>' +
      '<div class="multi-tab-body">' +
        '為了穩定的登入與資料同步體驗，<br>' +
        '建議只保留一個分頁。' +
        '<div class="multi-tab-divider"></div>' +
        '點下方按鈕可請其他舊分頁自動關閉<br>' +
        '<span style="font-size:.78rem;color:var(--text-muted)">（手動開的分頁可能要自行關閉）</span>' +
      '</div>' +
      '<div class="multi-tab-actions">' +
        '<button type="button" class="outline-btn" id="multi-tab-dismiss">我知道了</button>' +
        '<button type="button" class="primary-btn" id="multi-tab-close">關閉其他分頁</button>' +
      '</div>' +
    '</div>';
  wrapper.appendChild(overlay);
  document.body.appendChild(wrapper);

  const dismissBtn = document.getElementById('multi-tab-dismiss');
  const closeBtn = document.getElementById('multi-tab-close');
  dismissBtn?.addEventListener('click', () => {
    wrapper.remove();
  });
  closeBtn?.addEventListener('click', () => {
    requestCloseOthers();
    wrapper.remove();
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
  try {
    multiTabChannel?.close();
  } catch {
    /* ignore */
  }
  multiTabId = null;
  multiTabChannel = null;
  multiTabOthers = null;
  multiTabWarningShown = false;
  if (typeof document !== 'undefined') {
    document.getElementById('multi-tab-warning')?.parentElement?.remove();
    document.getElementById('multi-tab-warning')?.remove();
  }
}
