import '../legacy/profile.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useUserRoles } from '@/data/user-roles';
import { lt, useT } from '@/i18n/i18n';
import { useViewer } from '../data/viewer';
import { buildIdentityQrPayload, renderQrToCanvas } from '../data/qr';

function canViewRawUidRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export default function QrPage(): JSX.Element {
  const t = useT();
  const location = useLocation();
  const viewer = useViewer();
  const uid = viewer.uid ? String(viewer.uid).trim() : '';
  const rolesMap = useUserRoles(uid ? [uid] : []);
  const showRawUid =
    Boolean(uid) &&
    (canViewRawUidRole(viewer.role) || canViewRawUidRole(rolesMap[uid]));

  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'guest' | 'loading' | 'ready' | 'error'>(
    uid ? 'loading' : 'guest',
  );
  const [loginPending, setLoginPending] = useState(false);

  useEffect(() => {
    const host = canvasBoxRef.current;
    if (!uid) {
      host?.replaceChildren();
      setStatus('guest');
      return;
    }

    let active = true;
    if (host) host.replaceChildren();
    setStatus('loading');

    // 每次請求使用獨立、未掛載 canvas，舊請求無法畫進新帳號的畫布。
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('profile.qr'));

    Promise.resolve()
      .then(() => renderQrToCanvas(canvas, buildIdentityQrPayload(uid)))
      .then(() => {
        if (!active) return;
        const currentHost = canvasBoxRef.current;
        if (currentHost) currentHost.replaceChildren(canvas);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        const currentHost = canvasBoxRef.current;
        if (currentHost) currentHost.replaceChildren();
        setStatus('error');
      });

    return () => {
      active = false;
      const currentHost = canvasBoxRef.current;
      if (currentHost) currentHost.replaceChildren();
    };
  }, [uid, attempt, t]);

  const handleBack = useCallback((): void => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    location.route('/profile');
  }, [location]);

  const handleGuestLogin = useCallback((): void => {
    if (loginPending) return;
    setLoginPending(true);
    import('@/data/auth')
      .then((auth) => auth.signIn())
      .catch(() => undefined)
      .finally(() => {
        setLoginPending(false);
      });
  }, [loginPending]);

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-qrcode">
        <div class="page-header">
          <button
            type="button"
            class="back-btn"
            onClick={handleBack}
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
          >
            <svg
              class="back-btn-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <h2 data-i18n="我的 QR Code">{lt('我的 QR Code', '我的 QR Code')}</h2>
        </div>

        <div class="center-content">
          <div class="qr-placeholder">
            <div
              ref={canvasBoxRef}
              class="qr-box"
              id="page-qr-canvas"
              aria-busy={status === 'loading'}
            >
              {status !== 'ready' && (
                <span>
                  QR
                  <br />
                  CODE
                </span>
              )}
            </div>

            {status === 'guest' && (
              <div style="margin-top:.8rem;text-align:center">
                <p class="uid-text" id="page-qr-uid">
                  登入後即可顯示簽到 QR Code
                </p>
                <button
                  type="button"
                  disabled={loginPending}
                  onClick={handleGuestLogin}
                  style="margin-top:.6rem;padding:.55rem 1.2rem;border:none;border-radius:var(--radius);background:#06C755;color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.4rem"
                >
                  LINE 登入
                </button>
              </div>
            )}

            {status === 'loading' && (
              <p role="status" class="qr-hint">
                {t('profile.qrLoading')}
              </p>
            )}

            {status === 'error' && (
              <div style="margin-top:.6rem;text-align:center">
                <p role="alert" class="qr-hint">
                  {t('profile.qrError')}
                </p>
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                  style="margin-top:.4rem;padding:.4rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.8rem;cursor:pointer"
                >
                  {t('profile.retry')}
                </button>
              </div>
            )}

            {status === 'ready' && (
              <>
                <p
                  class="uid-text"
                  id="page-qr-uid"
                  data-i18n="簽到 QR Code"
                >
                  {showRawUid ? uid : lt('簽到 QR Code', '簽到 QR Code')}
                </p>
                <p class="qr-hint" data-i18n="掃碼查看個人資料卡片">
                  {lt('掃碼查看個人資料卡片', '掃碼查看個人資料卡片')}
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
