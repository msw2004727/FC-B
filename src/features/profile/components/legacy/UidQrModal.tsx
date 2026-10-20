import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { on } from '@/core/events';
import type { AuthUser } from '@/data/auth';
import { useUserRoles } from '@/data/user-roles';
import { toast } from '@/ui/Toast';
import { buildIdentityQrPayload, renderQrToCanvas } from '../../data/qr';
import { useViewer } from '../../data/viewer';

export interface UidQrModalProps {
  /** 由 App 傳入目前登入者（null 為訪客）；未傳時退回 viewer.uid。 */
  user?: AuthUser | null;
  /** 訪客點擊 LINE 登入按鈕時呼叫（沿用 App 既有登入流程）。 */
  onLogin?: () => void | Promise<void>;
  /** 登入進行中狀態。 */
  loginPending?: boolean;
  /** 測試或外部受控初始開啟狀態。 */
  defaultOpen?: boolean;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

const QR_SIZE_PX = 270;
const CACHE_KEY_UID = 'shub_qr_uid';
const CACHE_KEY_DATA = 'shub_qr_data';

function canViewRawUidRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

function readCachedQrDataUrl(uid: string): string | null {
  if (!uid) return null;
  try {
    const cachedUid = localStorage.getItem(CACHE_KEY_UID);
    const cachedData = localStorage.getItem(CACHE_KEY_DATA);
    if (
      cachedUid === uid &&
      typeof cachedData === 'string' &&
      cachedData.startsWith('data:image/')
    ) {
      return cachedData;
    }
  } catch {
    // localStorage 不可用時靜默略過
  }
  return null;
}

function writeCachedQrDataUrl(uid: string, canvas: HTMLCanvasElement): void {
  if (!uid) return;
  try {
    const dataUrl = canvas.toDataURL('image/png');
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      localStorage.setItem(CACHE_KEY_UID, uid);
      localStorage.setItem(CACHE_KEY_DATA, dataUrl);
    }
  } catch {
    // canvas.toDataURL 或 localStorage 不可用時略過
  }
}

/**
 * 全站 UID／簽到 QR Code 彈窗（M-025、M-026、M-027、M-029、U-005、U-006）。
 *
 * - DOM 結構與 inline style 照 A `pages/modals.html` `#uid-qr-modal` 與 `profile-card.js` `showUidQrCode`。
 * - R-SHARE-004 / R-SHARE-013：只以本機 `qrcode` 產生 raw UID QR，失敗顯示錯誤，絕不呼叫任何外部網址。
 * - 一般用戶標題「我的簽到 QR Code」且不顯示 UID；admin / super_admin 標題「我的 UID QR Code」並顯示 UID 與「複製 UID」。
 * - 訪客顯示「登入後即可顯示簽到 QR Code」＋ LINE 登入按鈕（M-029 + U-006）。
 * - 開啟期間啟動 Screen Wake Lock 防止螢幕熄滅，關閉或卸載時釋放（U-005）。
 */
export function UidQrModal({
  user,
  onLogin,
  loginPending = false,
  defaultOpen = false,
}: UidQrModalProps = {}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const viewer = useViewer();
  // ASSUMPTION: 若 App 有傳 user，以 user.uid 為準（登出時立即為 null）；未傳時使用 viewer.uid。
  const effectiveUid = (user !== undefined ? user?.uid : viewer.uid) ?? null;
  const uid = effectiveUid ? String(effectiveUid).trim() : '';

  const rolesMap = useUserRoles(uid ? [uid] : []);
  const showRawUid =
    Boolean(uid) &&
    (canViewRawUidRole(viewer.role) || canViewRawUidRole(rolesMap[uid]));

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [qrStatus, setQrStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [cachedDataUrl, setCachedDataUrl] = useState<string | null>(null);

  useEffect(() => {
    return on('qr:open', () => {
      setOpen(true);
    });
  }, []);

  // U-005：彈窗開啟時用 Screen Wake Lock 防止螢幕熄滅；不支援或失敗時靜默略過。
  useEffect(() => {
    if (!open) return;
    let active = true;
    let sentinel: WakeLockSentinelLike | null = null;
    const nav = (typeof navigator !== 'undefined'
      ? (navigator as unknown as NavigatorWithWakeLock)
      : undefined);

    if (nav?.wakeLock && typeof nav.wakeLock.request === 'function') {
      nav.wakeLock
        .request('screen')
        .then((lock) => {
          if (!active) {
            lock.release().catch(() => undefined);
            return;
          }
          sentinel = lock;
        })
        .catch(() => {
          // 權限被拒或不支援時不報錯
        });
    }

    return () => {
      active = false;
      if (sentinel) {
        const toRelease = sentinel;
        sentinel = null;
        toRelease.release().catch(() => undefined);
      }
    };
  }, [open]);

  // 本機產生 QR（有同 UID 本機 data:image/ 快取時先秒開，同時以本機 canvas 更新）。
  useEffect(() => {
    if (!open) return;
    if (!uid) {
      setCachedDataUrl(null);
      setQrStatus('idle');
      return;
    }

    let active = true;
    const cached = readCachedQrDataUrl(uid);
    setCachedDataUrl(cached);
    setQrStatus(cached ? 'ready' : 'loading');

    const host = canvasWrapRef.current;
    if (host) host.replaceChildren();

    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', showRawUid ? '我的 UID QR Code' : '我的簽到 QR Code');

    Promise.resolve()
      .then(() => renderQrToCanvas(canvas, buildIdentityQrPayload(uid)))
      .then(() => {
        if (!active) return;
        canvas.style.display = 'block';
        canvas.style.width = `${QR_SIZE_PX}px`;
        canvas.style.height = `${QR_SIZE_PX}px`;
        writeCachedQrDataUrl(uid, canvas);
        setCachedDataUrl(null);
        const currentHost = canvasWrapRef.current;
        if (currentHost) {
          currentHost.replaceChildren(canvas);
        }
        setQrStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        const currentHost = canvasWrapRef.current;
        if (currentHost) currentHost.replaceChildren();
        setCachedDataUrl(null);
        setQrStatus('error');
      });

    return () => {
      active = false;
      const currentHost = canvasWrapRef.current;
      if (currentHost) currentHost.replaceChildren();
    };
  }, [open, uid, showRawUid]);

  const handleClose = useCallback((): void => {
    setOpen(false);
  }, []);

  const handleOverlayClick = useCallback((event: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      setOpen(false);
    }
  }, []);

  const handleCopyUid = useCallback((): void => {
    if (!uid) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(uid)
        .then(() => {
          toast.show({ message: 'UID 已複製到剪貼簿', tone: 'success' });
        })
        .catch(() => {
          toast.show({ message: '複製失敗，請手動複製', tone: 'error' });
        });
    } else {
      toast.show({ message: '複製失敗，請手動複製', tone: 'error' });
    }
  }, [uid]);

  const handleGuestLogin = useCallback((): void => {
    if (loginPending) return;
    if (onLogin) {
      Promise.resolve(onLogin()).catch(() => undefined);
      return;
    }
    import('@/data/auth')
      .then((auth) => auth.signIn())
      .catch(() => undefined);
  }, [loginPending, onLogin]);

  const titleText = showRawUid ? '我的 UID QR Code' : '我的簽到 QR Code';

  return (
    <div class="legacy-ui legacy-chrome">
      <div
        id="uid-qr-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        style={{
          display: open ? 'flex' : 'none',
          position: 'fixed',
          inset: '0',
          zIndex: 1200,
          background: 'rgba(0,0,0,.35)',
          WebkitBackdropFilter: 'blur(10px)',
          backdropFilter: 'blur(10px)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={handleOverlayClick}
      >
        <div
          style="background:var(--bg-card);border-radius:var(--radius-lg);max-width:320px;width:85%;padding:1.5rem;text-align:center;position:relative"
        >
          <button
            type="button"
            aria-label="關閉"
            style="position:absolute;top:.5rem;right:.7rem;background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-muted)"
            onClick={handleClose}
          >
            ✕
          </button>
          <div id="uid-qr-content">
            <div style="font-size:.85rem;font-weight:700;margin-bottom:.8rem">
              {titleText}
            </div>

            {!uid ? (
              <div style="padding:.5rem 0">
                <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.9rem">
                  登入後即可顯示簽到 QR Code
                </div>
                <button
                  type="button"
                  disabled={loginPending}
                  onClick={handleGuestLogin}
                  style="padding:.55rem 1.2rem;border:none;border-radius:var(--radius);background:#06C755;color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.4rem"
                >
                  LINE 登入
                </button>
              </div>
            ) : (
              <>
                <div
                  id="uid-qr-canvas"
                  style={{
                    background: '#fff',
                    display: qrStatus === 'error' ? 'none' : 'inline-block',
                    padding: '4px',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  {cachedDataUrl && (
                    <img
                      src={cachedDataUrl}
                      width={QR_SIZE_PX}
                      height={QR_SIZE_PX}
                      alt="QR Code"
                      style="display:block"
                    />
                  )}
                  <div ref={canvasWrapRef} />
                </div>

                {qrStatus === 'error' && (
                  <div
                    role="alert"
                    style="font-size:.78rem;color:var(--text-muted);padding:1rem"
                  >
                    無法生成 QR Code，請稍後再試
                  </div>
                )}

                {showRawUid && (
                  <>
                    <div
                      data-testid="uid-qr-raw-uid"
                      style="margin-top:.7rem;font-size:.75rem;color:var(--text-muted);word-break:break-all"
                    >
                      {uid}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyUid}
                      style="margin-top:.6rem;padding:.45rem 1.2rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.8rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                      複製 UID
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
