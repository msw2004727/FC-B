// M-049：同步／離線狀態條（照 A `index.html:1131-1137`、`js/modules/sync-status.js:48-85`）

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { on } from '@/core/events';
import { lt } from '@/i18n/i18n';
import { OFFLINE_SYNC_MSG } from '@/core/unavailable';
import type { SyncBarState } from '@/core/sync-status';

export function SyncStatusBar(): JSX.Element {
  const [state, setState] = useState<SyncBarState>(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'offline';
    }
    return 'idle';
  });
  const [text, setText] = useState<string>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE_SYNC_MSG : '',
  );
  const retryRef = useRef<(() => void) | null>(null);
  const [hasRetry, setHasRetry] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<SyncBarState>(state);
  stateRef.current = state;

  useEffect(() => {
    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const applyState = (
      nextState: SyncBarState,
      customText?: string,
      retryFn?: (() => void) | null,
    ): void => {
      clearTimer();
      stateRef.current = nextState;
      setState(nextState);
      retryRef.current = retryFn ?? null;
      setHasRetry(Boolean(retryFn));

      switch (nextState) {
        case 'syncing':
          setText(customText || '資料同步中...');
          break;
        case 'done':
          setText(customText || '已同步');
          timerRef.current = setTimeout(() => {
            if (stateRef.current === 'done') {
              stateRef.current = 'idle';
              setState('idle');
              setText('');
            }
          }, 1200);
          break;
        case 'error':
          setText(customText || '同步失敗');
          break;
        case 'offline':
          setText(customText || OFFLINE_SYNC_MSG);
          break;
        case 'idle':
        default:
          setText('');
          break;
      }
    };

    const offEvent = on('sync:state', ({ state: next, text: nextText, retry }) => {
      applyState(next, nextText, retry);
    });

    const handleOffline = (): void => {
      applyState('offline');
    };

    const handleOnline = (): void => {
      if (stateRef.current === 'offline') {
        applyState('syncing');
        timerRef.current = setTimeout(() => {
          if (stateRef.current === 'syncing') {
            applyState('done');
          }
        }, 2000);
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimer();
      offEvent();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const modifierClass =
    state === 'idle' ? '' : ` sync-bar--${state}`;

  return (
    <div class="legacy-ui legacy-chrome">
      <div id="sync-bar" class={`sync-bar${modifierClass}`} aria-live="polite">
        <div class="sync-bar__track" />
        <div class="sync-bar__msg">
          <span class="sync-bar__text">{text}</span>
          <button
            class="sync-bar__retry"
            type="button"
            style={{ display: state === 'error' && hasRetry ? '' : 'none' }}
            data-i18n="重試"
            onClick={() => {
              retryRef.current?.();
            }}
          >
            {lt('重試', '重試')}
          </button>
        </div>
      </div>
    </div>
  );
}
