/**
 * 俱樂部邀請 QR 浮層，對應 A `team-detail-invite.js showTeamInviteQR`。
 * 與 A 的差異：本機 QR、fail-closed、不載入第三方服務；
 * 補齊 Esc／焦點循環與還原／aria／返回鍵，按鈕 min-height 44px。
 */
import { Fragment, type JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { buildShareUrl } from '@/features/events/data/event-share-builders';
import { renderQrToCanvas } from '@/features/profile/data/qr';
import { toast } from '@/ui/Toast';

export interface TeamInviteQrOverlayProps {
  teamId: string;
  teamName: string;
  onClose: () => void;
}

export function buildTeamInviteShareText(teamName: string, url: string): string {
  const cleanName = teamName.trim();
  const clubLabel = cleanName ? `「${cleanName}」` : '這個俱樂部';
  return `${clubLabel}正在 ToosterX 招募夥伴，歡迎加入俱樂部，一起運動、揪團、參加活動。\n${url}`;
}

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea');
  const previousFocus = document.activeElement;
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';

  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
  }
}

async function shareOrCopyTeamInvite(shareText: string): Promise<void> {
  if (!shareText) return;

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: shareText });
      return;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError'
      ) {
        return;
      }
    }
  }

  let copied = false;
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(shareText);
      copied = true;
    }
  } catch {
    // 剪貼簿 API 不可用時，繼續使用本機 textarea fallback。
  }

  if (!copied) copied = copyTextFallback(shareText);
  toast.show({
    message: copied ? '邀請內容已複製' : '複製失敗',
    tone: copied ? 'success' : 'error',
  });
}

/** 以 URL 作為 key，讓換邀請對象時重設錯誤狀態並隔離舊的非同步結果。 */
function InviteQrCanvas({ url }: { url: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(!url);

  useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current;

    if (!url || !canvas) {
      setFailed(true);
      return () => {
        alive = false;
      };
    }

    async function draw(): Promise<void> {
      try {
        if (!canvas) return;
        await renderQrToCanvas(canvas, url);
        if (!alive) return;
        // 共用 renderer 會移除 inline 尺寸，因此完成後恢復 A 的顯示尺寸。
        canvas.style.width = '200px';
        canvas.style.height = '200px';
        canvas.style.display = 'block';
      } catch {
        if (alive) setFailed(true);
      }
    }

    draw().catch(() => {
      // 獨立非同步工作的最後一道拒絕處理；不使用任何外部備援。
    });

    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div id="qr-invite-target" style="display:flex;justify-content:center;margin:.5rem 0">
      {failed ? (
        <div role="alert" style="font-size:.8rem;color:var(--text-muted,#6b7280)">
          QR Code 載入失敗
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          aria-label="QR Code"
          role="img"
          style="width:200px;height:200px;display:block"
        />
      )}
    </div>
  );
}

export function TeamInviteQrOverlay(
  props: TeamInviteQrOverlayProps,
): JSX.Element | null {
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const closedRef = useRef(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);

  const url = props.teamId.trim() ? buildShareUrl('team', props.teamId) : '';
  const shareText = buildTeamInviteShareText(props.teamName, url);

  const releaseOverlay = useCallback((): void => {
    const release = releaseRef.current;
    releaseRef.current = null;
    release?.();
  }, []);

  const close = useCallback((): void => {
    if (closedRef.current) return;
    closedRef.current = true;
    releaseOverlay();
    onCloseRef.current();
  }, [releaseOverlay]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const previousFocus = document.activeElement;
    releaseRef.current = pushOverlay(() => {
      close();
      return true;
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };

    document.addEventListener('keydown', onKeyDown);
    closeBtnRef.current?.focus();

    return () => {
      closedRef.current = true;
      document.removeEventListener('keydown', onKeyDown);
      releaseOverlay();
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [close, releaseOverlay]);

  const trapFocus = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const first = copyBtnRef.current;
    const last = closeBtnRef.current;
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleShare = (): void => {
    shareOrCopyTeamInvite(shareText).catch(() => {
      // L-07／L-12：事件的 Promise 必須自行收尾，包括宿主 API 的非預期例外。
    });
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div class="legacy-ui">
      <div
        id="qr-invite-overlay"
        style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-invite-title"
          style="background:var(--bg-card,#fff);border-radius:14px;padding:1.2rem;text-align:center;max-width:340px;width:90%"
          onKeyDown={trapFocus}
        >
          <div
            id="qr-invite-title"
            style="font-size:.95rem;font-weight:700;margin-bottom:.5rem"
          >
            {props.teamName} 邀請加入
          </div>
          <InviteQrCanvas key={url} url={url} />
          <div style="font-size:.72rem;color:var(--text-muted,#6b7280);line-height:1.6;white-space:normal;word-break:break-word">
            {shareText.split('\n').map((line, index) => (
              <Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </div>
          <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:.5rem;word-break:break-all;user-select:all">
            {url}
          </div>
          <div style="display:flex;gap:.5rem;justify-content:center;margin-top:.6rem">
            <button
              ref={copyBtnRef}
              id="qr-copy-btn"
              type="button"
              style="padding:.4rem 1rem;border:1px solid var(--primary,#3b82f6);border-radius:8px;background:transparent;color:var(--primary,#3b82f6);font-size:.82rem;cursor:pointer;min-height:44px"
              onClick={handleShare}
            >
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function'
                ? '分享邀請'
                : '複製邀請'}
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              aria-label="關閉"
              style="padding:.4rem 1rem;border:none;border-radius:8px;background:var(--primary,#3b82f6);color:#fff;font-size:.82rem;cursor:pointer;min-height:44px"
              onClick={close}
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
