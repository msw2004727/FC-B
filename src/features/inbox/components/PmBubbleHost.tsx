// 全站私訊即時泡泡。
// 照 A `js/modules/message/pm-listener.js#_handlePmAuthUser`、
// `_queuePmIncomingBubble`、`_showPmIncomingBubble`、`_handlePmFreshBubbleTimeout`
// 與 `css/message.css` 的 `.pm-incoming-*` 樣式（已存在 B 的 legacy CSS）。

import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { lt } from '@/i18n/i18n';

import { subscribeThreads, type PmThread, type PmUnsubscribe } from '../data/pm-repo';
import { openPmDialog, usePmDialogTarget } from './pm-dialog-store';
import {
  PM_INCOMING_BUBBLE_DELAY_MS,
  PM_INCOMING_BUBBLE_DURATION_MS,
  findNewUnreadThread,
  pmConversationKey,
  resolvePeerUid,
} from './pm-bubble-model';

interface BubbleState {
  mode: 'fresh' | 'reminder';
  peerUid: string;
  peerName: string;
  peerAvatar: string | null;
  conversationId: string;
  lastMessageBody: string | null;
  lastMessageStatus: string | null;
  labelKey: '私訊' | '未讀';
}

/**
 * 全站私訊浮動泡泡主機。
 * - uid 有值才訂閱 `users/{uid}/pmThreads`（照 A `_handlePmAuthUser`）。
 * - uid 變空或換 uid 時退訂並清掉泡泡與計時器。
 * - 只由外框 App 以 lazy 動態載入，避免首屏帶入 firestore。
 */
export function PmBubbleHost({ uid }: { uid: string | null }): JSX.Element | null {
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const prevThreadsRef = useRef<PmThread[] | null>(null);
  const latestThreadsRef = useRef<PmThread[]>([]);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const dialogTarget = usePmDialogTarget();
  const dialogTargetRef = useRef(dialogTarget);
  // L-04：render 期讀值，effect 訂閱後 hook 會補讀一次目前值；ref 每次 render 都補。
  dialogTargetRef.current = dialogTarget;

  const clearTimers = useCallback((): void => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideBubble = useCallback((): void => {
    clearTimers();
    setBubble(null);
  }, [clearTimers]);

  // 照 A `_queuePmIncomingBubble` + `_showPmIncomingBubble` + `_handlePmFreshBubbleTimeout`。
  const scheduleBubble = useCallback((thread: PmThread, myUid: string): void => {
    clearTimers();
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      if (!mountedRef.current) return;
      const peerUid = resolvePeerUid(thread, myUid);
      const conversationId = pmConversationKey(thread);
      if (!peerUid || !conversationId) return;
      // 目前浮層已開著同一對話時不提醒（照 A `_isPmDialogOpenForConversation`，
      // B 的對話以 peer UID 識別）。
      if (dialogTargetRef.current?.uid === peerUid) return;

      const peerName = typeof thread.peerName === 'string' ? thread.peerName : '';
      const peerAvatar = typeof thread.peerAvatar === 'string' && thread.peerAvatar
        ? thread.peerAvatar
        : null;
      const lastMessageBody = typeof thread.lastMessageBody === 'string' && thread.lastMessageBody
        ? thread.lastMessageBody
        : null;
      const lastMessageStatus = typeof thread.lastMessageStatus === 'string' && thread.lastMessageStatus
        ? thread.lastMessageStatus
        : null;

      setBubble({
        mode: 'fresh',
        peerUid,
        peerName,
        peerAvatar,
        conversationId,
        lastMessageBody,
        lastMessageStatus,
        labelKey: '私訊',
      });

      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (!mountedRef.current) return;
        const current = latestThreadsRef.current.find(
          (t) => pmConversationKey(t) === conversationId,
        );
        const stillUnread = current
          ? Math.max(0, Number(current.unreadCount ?? 0)) > 0
          : false;
        if (stillUnread) {
          // 仍未讀 → 轉成可關閉的未讀提醒（照 A 未讀模式：label「未讀」、可關閉按鈕）。
          setBubble((prev) =>
            prev
              ? { ...prev, mode: 'reminder', labelKey: '未讀' }
              : null,
          );
        } else {
          setBubble(null);
        }
      }, PM_INCOMING_BUBBLE_DURATION_MS);
    }, PM_INCOMING_BUBBLE_DELAY_MS);
  }, [clearTimers]);

  // 只追蹤元件自身是否仍掛載（照 A `_pmIncomingBubbleVisible` 語意）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 照 A `_handlePmAuthUser`：uid 有值才訂閱；uid 變空或換 uid 時退訂並清空。
  useEffect(() => {
    if (!uid) {
      hideBubble();
      prevThreadsRef.current = null;
      latestThreadsRef.current = [];
      return undefined;
    }
    let cancelled = false;
    prevThreadsRef.current = null;
    latestThreadsRef.current = [];
    hideBubble();
    let unsub: PmUnsubscribe | null = null;
    try {
      unsub = subscribeThreads(uid, (threads) => {
        if (cancelled) return;
        const prev = prevThreadsRef.current;
        prevThreadsRef.current = threads;
        latestThreadsRef.current = threads;
        const triggered = findNewUnreadThread(prev, threads);
        if (triggered) scheduleBubble(triggered, uid);
      }, (err) => {
        console.warn('[PmBubbleHost] subscribeThreads error', err);
      });
    } catch (err) {
      console.warn('[PmBubbleHost] subscribeThreads failed', err);
    }
    return () => {
      cancelled = true;
      if (unsub) {
        try { unsub(); } catch { /* 照 A，忽略退訂例外 */ }
      }
      clearTimers();
    };
  }, [uid, scheduleBubble, hideBubble, clearTimers]);

  const handleClick = useCallback((): void => {
    if (!bubble) return;
    const target = {
      uid: bubble.peerUid,
      ...(bubble.peerName ? { name: bubble.peerName } : {}),
      ...(bubble.peerAvatar ? { pictureUrl: bubble.peerAvatar } : {}),
    };
    hideBubble();
    openPmDialog(target);
  }, [bubble, hideBubble]);

  const handleKeyDown = useCallback((event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleClick();
  }, [handleClick]);

  const handleClose = useCallback((event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    hideBubble();
  }, [hideBubble]);

  if (!bubble) return null;

  const isReminder = bubble.mode === 'reminder';
  const titleText = bubble.peerName || bubble.peerUid;

  let statusText: string;
  if (isReminder) {
    statusText = lt('點擊查看對話', '點擊查看對話');
  } else if (bubble.lastMessageStatus === 'recalled') {
    statusText = lt('訊息已撤回', '訊息已撤回');
  } else if (bubble.lastMessageBody !== null) {
    statusText = bubble.lastMessageBody; // 使用者原文，A 沒走 data-i18n
  } else {
    statusText = lt('你有新私訊', '你有新私訊');
  }

  const labelText = bubble.labelKey === '未讀'
    ? lt('未讀', '未讀')
    : lt('私訊', '私訊');
  const className = `pm-incoming-bubble is-visible${isReminder ? ' is-reminder' : ''}`;
  const avatarAlt = '';

  return (
    <div
      id="pm-incoming-bubble"
      className={className}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="pm-incoming-avatar">
        {bubble.peerAvatar
          ? (
            <img
              src={bubble.peerAvatar}
              alt={avatarAlt}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          )
          : <span>{(bubble.peerName || '?').slice(0, 1)}</span>}
      </span>
      <span className="pm-incoming-main">
        <strong>{titleText}</strong>
        <span>{statusText}</span>
      </span>
      <span className="pm-incoming-label">{labelText}</span>
      {isReminder && (
        <button
          type="button"
          className="pm-incoming-close"
          aria-label={lt('關閉未讀私訊提醒', '關閉未讀私訊提醒')}
          onClick={handleClose}
        >
          ×
        </button>
      )}
    </div>
  );
}
