import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import {
  editPrivateMessage,
  markConversationRead,
  PM_MAX_BODY_LENGTH,
  recallPrivateMessage,
  sendPrivateMessage,
  subscribeConversation,
  type PmMessage,
} from '../data/pm-repo';
import { closePmDialog, usePmDialogTarget } from './pm-dialog-store';
import { formatPmTime, renderPmMessageBody } from './pm-message-format';

const PM_MARK_READ_DEBOUNCE_MS = 500;
const PM_KEYBOARD_MIN_VIEWPORT_HEIGHT = 320;
const PM_KEYBOARD_RESTORE_DELAY_MS = 320;
const PM_KEYBOARD_ACCESSORY_GAP_PX = 0;
const PM_KEYBOARD_MIN_KEYBOARD_RESERVE_PX = 260;

const SAFETY_NOTICE =
  '安全提醒：此連結由用戶提供，開啟前請確認網址與對方身份。ToosterX 不會透過私訊要求你提供密碼、驗證碼或付款資訊。';

const UID_RE = /^U[0-9a-f]{32}$/i;

// ASSUMPTION: B 尚無共用 toast 模組，先以瀏覽器 alert 呈現 A `showToast` 的原文。
function showToast(message: string): void {
  try {
    window.alert(message);
  } catch {
    console.warn('[pm-dialog]', message);
  }
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code?: unknown }).code ?? '');
  }
  return '';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return '';
}

/** 照 A `pmBuildConversationId`：`pm_<uidA>_<uidB>`，兩 UID 排序固定。 */
function buildConversationId(myUid: string, peerUid: string): string {
  const a = String(myUid ?? '').trim();
  const b = String(peerUid ?? '').trim();
  if (!a || !b || !UID_RE.test(a) || !UID_RE.test(b)) return '';
  const first = a < b ? a : b;
  const second = a < b ? b : a;
  return `pm_${first}_${second}`;
}

function getMessageId(message: PmMessage): string {
  return String(message.messageId || message.id || message._docId || '');
}

function isPmDialogTextControl(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement) || !el.closest('#pm-dialog-overlay')) return false;
  if (el.matches('.pm-dialog-input, .pm-dialog-search')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName.toUpperCase());
}

function isIOSPmViewport(): boolean {
  const nav = window.navigator;
  const platform = String(nav.platform || '');
  const ua = String(nav.userAgent || '');
  if (/iP(ad|hone|od)/i.test(platform) || /iP(ad|hone|od)/i.test(ua)) return true;
  return platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
}

interface UsableViewportParams {
  layoutHeight: number;
  viewportHeight: number;
  viewportTop: number;
  keyboardOpen: boolean;
}

/** 照 A `_getPmDialogUsableViewportHeight`。 */
function getPmDialogUsableViewportHeight(params: UsableViewportParams): {
  height: number;
  reclaimed: number;
} {
  const minHeight = PM_KEYBOARD_MIN_VIEWPORT_HEIGHT;
  const safeLayoutHeight = Math.max(0, Number(params.layoutHeight || 0));
  const safeViewportHeight = Math.max(minHeight, Number(params.viewportHeight || minHeight));
  const safeViewportTop = Math.max(0, Number(params.viewportTop || 0));
  const maxUsableHeight = safeLayoutHeight
    ? Math.max(minHeight, safeLayoutHeight - safeViewportTop)
    : safeViewportHeight;

  if (!params.keyboardOpen || !isIOSPmViewport()) {
    return { height: Math.min(safeViewportHeight, maxUsableHeight), reclaimed: 0 };
  }

  const accessoryMax = Math.max(0, PM_KEYBOARD_ACCESSORY_GAP_PX);
  const keyboardReserve = Math.max(0, PM_KEYBOARD_MIN_KEYBOARD_RESERVE_PX);
  const keyboardDelta = Math.max(0, safeLayoutHeight - safeViewportHeight - safeViewportTop);
  const reclaimed = Math.min(accessoryMax, Math.max(0, keyboardDelta - keyboardReserve));
  const height = Math.min(safeViewportHeight + reclaimed, maxUsableHeight);
  return {
    height,
    reclaimed: Math.max(0, height - safeViewportHeight),
  };
}

export function PmDialogOverlay(): JSX.Element | null {
  const lt = useLegacyT();
  const { route } = useLocation();
  const { uid } = useViewer();
  const target = usePmDialogTarget();

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readRunningRef = useRef(false);
  const pageScrollYRef = useRef(0);
  const viewportFrameRef = useRef(0);
  const keyboardRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [messages, setMessages] = useState<PmMessage[]>([]);
  const [composeBody, setComposeBody] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState<{
    messageId: string;
    type: 'editing' | 'recalling';
  } | null>(null);

  const myUid = String(uid ?? '');
  const peerName = target?.name || target?.uid || '';
  const peerInitial = String(peerName || '?').slice(0, 1);
  const conversationId = useMemo(
    () => buildConversationId(myUid, target?.uid ?? ''),
    [myUid, target?.uid],
  );

  const filteredMessages = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return messages;
    return messages.filter(
      (message) =>
        String(message.body || '').toLowerCase().includes(keyword) ||
        String(message.senderName || '').toLowerCase().includes(keyword),
    );
  }, [messages, searchKeyword]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 切換對象時重設頁面狀態（照 A `_openPmDialogImpl` 先清空訊息與輸入）。
  useEffect(() => {
    setMessages([]);
    setComposeBody('');
    setSearchKeyword('');
    setSearchExpanded(false);
    setAvatarError(false);
    setSending(false);
    setBusyAction(null);
  }, [target?.uid]);

  useEffect(() => {
    if (!target) return;
    document.body.classList.add('pm-dialog-open');
    return () => {
      document.body.classList.remove('pm-dialog-open');
    };
  }, [target]);

  useEffect(() => {
    if (!target || conversationId) return;
    showToast(lt('無法開啟私訊', '無法開啟私訊'));
    closePmDialog();
  }, [target, conversationId, lt]);

  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const style = window.getComputedStyle(input);
    const maxHeight = parseFloat(style.maxHeight || '') || 112;
    const nextHeight = Math.min(
      input.scrollHeight || input.offsetHeight || maxHeight,
      maxHeight,
    );
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = (input.scrollHeight || 0) > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeInput();
  }, [composeBody, resizeInput]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [filteredMessages]);

  // 照 A `_installPmDialogViewportGuard`：iOS 鍵盤／visualViewport 保護。
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !target) return undefined;

    let disposed = false;
    const vv = window.visualViewport || null;
    const root = document.documentElement;
    const minHeight = PM_KEYBOARD_MIN_VIEWPORT_HEIGHT;
    const restoreDelay = PM_KEYBOARD_RESTORE_DELAY_MS;
    pageScrollYRef.current = window.scrollY || root.scrollTop || 0;

    const scrollToBottomSoon = (): void => {
      requestAnimationFrame(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
      });
    };

    const update = (): void => {
      if (disposed || overlay.style.display === 'none') return;
      const layoutHeight = window.innerHeight || root.clientHeight || 0;
      const viewportHeight = Math.max(
        minHeight,
        Math.floor(vv?.height || layoutHeight || minHeight),
      );
      const viewportTop = Math.max(0, Math.floor(vv?.offsetTop || 0));
      const focused = isPmDialogTextControl(document.activeElement);
      const resizedForKeyboard =
        !!vv && layoutHeight > 0 && layoutHeight - viewportHeight > 80;
      const keyboardOpen = !!focused && (resizedForKeyboard || window.innerWidth <= 560);
      const usable = getPmDialogUsableViewportHeight({
        layoutHeight,
        viewportHeight,
        viewportTop,
        keyboardOpen,
      });

      overlay.style.setProperty('--pm-vv-height', `${Math.floor(usable.height)}px`);
      overlay.style.setProperty('--pm-vv-raw-height', `${viewportHeight}px`);
      overlay.style.setProperty('--pm-keyboard-reclaim', `${Math.floor(usable.reclaimed || 0)}px`);
      overlay.style.setProperty('--pm-vv-top', `${viewportTop}px`);
      overlay.classList.toggle('is-keyboard-open', keyboardOpen);
      if (keyboardOpen) scrollToBottomSoon();
    };

    const schedule = (): void => {
      if (disposed) return;
      if (viewportFrameRef.current) cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = requestAnimationFrame(update);
    };

    const restore = (): void => {
      if (disposed) return;
      if (keyboardRestoreTimerRef.current) clearTimeout(keyboardRestoreTimerRef.current);
      keyboardRestoreTimerRef.current = setTimeout(() => {
        schedule();
        if (!isPmDialogTextControl(document.activeElement)) {
          overlay.classList.remove('is-keyboard-open');
          try {
            window.scrollTo(0, pageScrollYRef.current || 0);
          } catch {
            // 忽略瀏覽器限制。
          }
        }
      }, restoreDelay);
    };

    const onFocusIn = (event: FocusEvent): void => {
      const el = event.target instanceof Element ? event.target : null;
      if (isPmDialogTextControl(el)) {
        overlay.classList.add('is-keyboard-open');
        schedule();
      }
    };
    const onFocusOut = (event: FocusEvent): void => {
      const el = event.target instanceof Element ? event.target : null;
      if (isPmDialogTextControl(el)) restore();
    };

    overlay.addEventListener('focusin', onFocusIn);
    overlay.addEventListener('focusout', onFocusOut);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', restore);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    schedule();

    return () => {
      disposed = true;
      if (viewportFrameRef.current) cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = 0;
      if (keyboardRestoreTimerRef.current) clearTimeout(keyboardRestoreTimerRef.current);
      keyboardRestoreTimerRef.current = null;
      overlay.removeEventListener('focusin', onFocusIn);
      overlay.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', restore);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      overlay.classList.remove('is-keyboard-open');
      overlay.style.removeProperty('--pm-vv-height');
      overlay.style.removeProperty('--pm-vv-raw-height');
      overlay.style.removeProperty('--pm-keyboard-reclaim');
      overlay.style.removeProperty('--pm-vv-top');
    };
  }, [target?.uid]);

  // 照 A `_closePmDialog`：返回鍵、Esc、遮罩與 × 都關閉浮層。
  useEffect(() => {
    if (!target) return undefined;
    const release = pushOverlay(() => {
      closePmDialog();
      return true;
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePmDialog();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      release();
      document.removeEventListener('keydown', onKey, true);
    };
  }, [target]);

  // 照 A `_startPmConversationListener`：開啟時訂閱、關閉時退訂。
  useEffect(() => {
    if (!target || !myUid || !conversationId) return undefined;

    let active = true;
    let hasReceivedSnapshot = false;
    let unsubscribe: (() => void) | null = null;

    const clearReadTimer = (): void => {
      if (readTimerRef.current) {
        clearTimeout(readTimerRef.current);
        readTimerRef.current = null;
      }
    };

    const runMarkRead = async (): Promise<void> => {
      if (!active || readRunningRef.current) return;
      readRunningRef.current = true;
      try {
        let guard = 0;
        while (active && guard < 20) {
          guard += 1;
          const result = await markConversationRead(conversationId);
          if (!active) break;
          if (!result.hasMore) break;
          if (result.readCount <= 0) {
            console.warn('[pm-dialog] mark read stopped because server made no progress');
            break;
          }
        }
      } catch (err) {
        if (active) console.warn('[pm-dialog] mark read failed', err);
      } finally {
        readRunningRef.current = false;
      }
    };

    const scheduleMarkRead = (): void => {
      if (!active) return;
      clearReadTimer();
      readTimerRef.current = setTimeout(() => {
        readTimerRef.current = null;
        runMarkRead().catch((err) => {
          console.warn('[pm-dialog] mark read task failed', err);
        });
      }, PM_MARK_READ_DEBOUNCE_MS);
    };

    try {
      unsubscribe = subscribeConversation(
        myUid,
        conversationId,
        (nextMessages) => {
          if (!active) return;
          hasReceivedSnapshot = true;
          setMessages(nextMessages);
          const shouldMarkRead = nextMessages.some(
            (message) => message.direction === 'in' && message.read === false,
          );
          if (shouldMarkRead) scheduleMarkRead();
          else clearReadTimer();
        },
        (err) => {
          if (!active) return;
          console.warn('[pm-dialog] conversation load failed', err);
          if (!hasReceivedSnapshot) showToast(lt('私訊載入失敗', '私訊載入失敗'));
        },
      );
    } catch (err) {
      console.warn('[pm-dialog] conversation subscribe failed', err);
      showToast(lt('私訊載入失敗', '私訊載入失敗'));
    }

    return () => {
      active = false;
      clearReadTimer();
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (err) {
          console.warn('[pm-dialog] conversation unsubscribe failed', err);
        }
      }
    };
  }, [target, myUid, conversationId, lt]);

  const handlePeerProfile = useCallback(
    (event: JSX.TargetedMouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!target) return;
      closePmDialog();
      route(`/profile/${encodeURIComponent(target.uid)}`);
    },
    [target, route],
  );

  const handleSend = useCallback(async (): Promise<void> => {
    if (!target || sending) return;
    const body = composeBody.trim();
    if (!body) {
      showToast(lt('請輸入訊息', '請輸入訊息'));
      return;
    }
    if (body.length > PM_MAX_BODY_LENGTH) {
      showToast(
        lt('訊息最多 {max} 字', '訊息最多 {max} 字', { max: PM_MAX_BODY_LENGTH }),
      );
      return;
    }

    setComposeBody('');
    setSending(true);
    try {
      await sendPrivateMessage(target.uid, body);
    } catch (err) {
      console.warn('[pm-dialog] send failed', err);
      if (!mountedRef.current) return;
      setComposeBody((previous) => previous || body);
      const code = errorCode(err);
      if (code.includes('resource-exhausted')) {
        showToast(lt('私訊太頻繁，請稍後再試', '私訊太頻繁，請稍後再試'));
      } else if (code.includes('permission-denied')) {
        showToast(lt('目前無法私訊此用戶', '目前無法私訊此用戶'));
      } else {
        showToast(lt('私訊送出失敗', '私訊送出失敗'));
      }
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [target, sending, composeBody, lt]);

  const handleEdit = useCallback(
    async (message: PmMessage): Promise<void> => {
      if (!target || !conversationId || busyAction) return;
      const messageId = getMessageId(message);
      if (!messageId) return;
      if (message.peerRead === true) {
        showToast(lt('對方已讀，無法編輯或撤回', '對方已讀，無法編輯或撤回'));
        return;
      }
      const nextBody = window.prompt(lt('編輯訊息', '編輯訊息'), String(message.body || ''));
      if (nextBody == null) return;
      const body = String(nextBody || '').trim();
      if (!body || body.length > PM_MAX_BODY_LENGTH) {
        showToast(
          lt('訊息最多 {max} 字', '訊息最多 {max} 字', { max: PM_MAX_BODY_LENGTH }),
        );
        return;
      }

      setBusyAction({ messageId, type: 'editing' });
      try {
        await editPrivateMessage(conversationId, messageId, body);
      } catch (err) {
        console.warn('[pm-dialog] edit failed', err);
        if (!mountedRef.current) return;
        const code = errorCode(err);
        const text = errorMessage(err);
        if (code.includes('failed-precondition') && text.includes('already read')) {
          showToast(lt('對方已讀，無法編輯或撤回', '對方已讀，無法編輯或撤回'));
        } else if (code.includes('failed-precondition')) {
          showToast(lt('訊息狀態已變更，無法編輯或撤回', '訊息狀態已變更，無法編輯或撤回'));
        } else {
          showToast(lt('編輯失敗，請稍後再試', '編輯失敗，請稍後再試'));
        }
      } finally {
        if (mountedRef.current) setBusyAction(null);
      }
    },
    [target, conversationId, busyAction, lt],
  );

  const handleRecall = useCallback(
    async (message: PmMessage): Promise<void> => {
      if (!target || !conversationId || busyAction) return;
      const messageId = getMessageId(message);
      if (!messageId) return;
      if (message.peerRead === true) {
        showToast(lt('對方已讀，無法編輯或撤回', '對方已讀，無法編輯或撤回'));
        return;
      }
      if (!window.confirm(lt('確定要撤回這則訊息嗎？', '確定要撤回這則訊息嗎？'))) return;

      setBusyAction({ messageId, type: 'recalling' });
      try {
        await recallPrivateMessage(conversationId, messageId);
      } catch (err) {
        console.warn('[pm-dialog] recall failed', err);
        if (!mountedRef.current) return;
        const code = errorCode(err);
        const text = errorMessage(err);
        if (code.includes('failed-precondition') && text.includes('already read')) {
          showToast(lt('對方已讀，無法編輯或撤回', '對方已讀，無法編輯或撤回'));
        } else if (code.includes('failed-precondition')) {
          showToast(lt('訊息狀態已變更，無法編輯或撤回', '訊息狀態已變更，無法編輯或撤回'));
        } else {
          showToast(lt('撤回失敗，請稍後再試', '撤回失敗，請稍後再試'));
        }
      } finally {
        if (mountedRef.current) setBusyAction(null);
      }
    },
    [target, conversationId, busyAction, lt],
  );

  const toggleSearch = useCallback((): void => {
    const next = !searchExpanded;
    setSearchExpanded(next);
    if (next) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearchKeyword('');
    }
  }, [searchExpanded]);

  if (!target) return null;

  return createPortal(
    <div class="legacy-ui">
      <div
        id="pm-dialog-overlay"
        class="pm-dialog-overlay"
        style={{ display: 'flex' }}
        ref={overlayRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePmDialog();
        }}
      >
        <section
          class="pm-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={lt('私訊對話', '私訊對話')}
        >
          <header class="pm-dialog-header">
            <button
              type="button"
              class="pm-dialog-avatar"
              aria-label={lt('Open user profile', 'Open user profile')}
              data-peer-uid={target.uid}
              data-peer-name={peerName}
              onClick={handlePeerProfile}
            >
              {target.pictureUrl && !avatarError ? (
                <img
                  src={target.pictureUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <span>{peerInitial}</span>
              )}
            </button>
            <div
              class={`pm-dialog-title${searchExpanded ? ' is-search-open' : ''}`}
            >
              <strong class="pm-dialog-peer-name" data-no-translate>
                {peerName}
              </strong>
              <div class="pm-dialog-peer-line">
                <span class="pm-dialog-peer-sub" data-no-translate>
                  {target.uid}
                </span>
                <button
                  type="button"
                  class={`pm-dialog-search-toggle${searchExpanded ? ' is-active' : ''}`}
                  aria-label={lt('搜尋對話', '搜尋對話')}
                  aria-expanded={searchExpanded}
                  onClick={toggleSearch}
                >
                  <svg
                    class="pm-dialog-search-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M10.75 5.25a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />
                    <path d="m15 15 4 4" />
                  </svg>
                </button>
                <input
                  ref={searchInputRef}
                  class="pm-dialog-search"
                  type="search"
                  placeholder={lt('搜尋', '搜尋')}
                  value={searchKeyword}
                  onInput={(event) => setSearchKeyword(event.currentTarget.value)}
                />
              </div>
            </div>
            <button
              type="button"
              class="pm-dialog-close"
              aria-label={lt('關閉', '關閉')}
              onClick={() => closePmDialog()}
            >
              ×
            </button>
          </header>

          <div class="pm-dialog-messages" ref={listRef}>
            {filteredMessages.length > 0 ? (
              filteredMessages.map((message, index) => {
                const messageId = getMessageId(message) || `message-${index}`;
                const own = message.fromUid === myUid || message.direction === 'out';
                const status = String(message.status || 'active');
                const recalled = status === 'recalled';
                const peerRead = own && message.peerRead === true;
                const isBusy = busyAction?.messageId === getMessageId(message);
                const canEditOrRecall = own && !recalled && !peerRead && !isBusy;
                const bodyText = recalled
                  ? lt('訊息已撤回', '訊息已撤回')
                  : String(message.body ?? '');
                const rendered = renderPmMessageBody(bodyText);

                const metaParts: string[] = [];
                const time = formatPmTime(message.createdAt);
                if (time) metaParts.push(time);
                if (isBusy) {
                  metaParts.push(
                    busyAction?.type === 'recalling'
                      ? lt('撤回中', '撤回中')
                      : lt('編輯中', '編輯中'),
                  );
                }
                if (status === 'edited') metaParts.push(lt('已編輯', '已編輯'));
                if (peerRead) metaParts.push(lt('已讀', '已讀'));

                return (
                  <article
                    key={messageId}
                    class={`pm-message${own ? ' is-own' : ' is-peer'}${
                      recalled ? ' is-recalled' : ''
                    }${isBusy ? ' is-pending' : ''}`}
                  >
                    <div class="pm-message-bubble">{rendered.nodes}</div>
                    {!recalled && rendered.hasExternalLink && (
                      <div class="pm-message-link-safety" role="note">
                        {lt(SAFETY_NOTICE, SAFETY_NOTICE)}
                      </div>
                    )}
                    <div class="pm-message-meta">
                      {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
                      {canEditOrRecall && (
                        <span class="pm-message-actions">
                          <button
                            type="button"
                            data-pm-action="edit"
                            data-message-id={getMessageId(message)}
                            onClick={() => {
                              handleEdit(message).catch((err) => {
                                console.error('[pm-dialog] edit task failed', err);
                              });
                            }}
                          >
                            {lt('編輯', '編輯')}
                          </button>
                          <button
                            type="button"
                            data-pm-action="recall"
                            data-message-id={getMessageId(message)}
                            onClick={() => {
                              handleRecall(message).catch((err) => {
                                console.error('[pm-dialog] recall task failed', err);
                              });
                            }}
                          >
                            {lt('撤回', '撤回')}
                          </button>
                        </span>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div class="pm-empty pm-empty-dialog">
                {lt('沒有符合條件的訊息', '沒有符合條件的訊息')}
              </div>
            )}
          </div>

          <form
            class="pm-dialog-compose"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend().catch((err) => {
                console.error('[pm-dialog] send task failed', err);
              });
            }}
          >
            <textarea
              ref={inputRef}
              class="pm-dialog-input"
              maxLength={PM_MAX_BODY_LENGTH}
              rows={1}
              placeholder={lt('輸入訊息，最多 {max} 字', '輸入訊息，最多 {max} 字', {
                max: PM_MAX_BODY_LENGTH,
              })}
              value={composeBody}
              onInput={(event) => {
                setComposeBody(event.currentTarget.value);
                resizeInput();
              }}
            />
            <button type="submit" class="pm-dialog-send" disabled={sending}>
              {sending ? lt('送出中', '送出中') : lt('送出', '送出')}
            </button>
          </form>
        </section>
      </div>
    </div>,
    document.body,
  );
}

export default PmDialogOverlay;
