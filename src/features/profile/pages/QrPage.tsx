import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { useViewer } from '../data/viewer';
import { buildIdentityQrPayload, renderQrToCanvas } from '../data/qr';
import { LoginGuide, Page } from '../ui/shared';

function IdentityCanvas({ uid }: { uid: string }) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    const host = container.current;
    if (!host) return;

    host.replaceChildren();
    setStatus('loading');

    // 每次請求使用獨立、未掛載 canvas，舊請求無法畫進新帳號的畫布。
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');

    Promise.resolve()
      .then(() => renderQrToCanvas(canvas, buildIdentityQrPayload(uid)))
      .then(() => {
        if (!active) return;
        host.replaceChildren(canvas);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        host.replaceChildren();
        setStatus('error');
      });

    return () => {
      active = false;
      host.replaceChildren();
    };
  }, [uid, attempt]);

  useEffect(() => {
    container.current?.querySelector('canvas')?.setAttribute('aria-label', t('profile.qr'));
  });

  return (
    <div class="profile-qr">
      <div
        ref={container}
        class="profile-qr-box"
        aria-busy={status === 'loading'}
        hidden={status !== 'ready'}
      />
      {status === 'loading' && <p role="status"><Text>{t('profile.qrLoading')}</Text></p>}
      {status === 'error' && (
        <div>
          <p role="alert"><Text>{t('profile.qrError')}</Text></p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            <Text>{t('profile.retry')}</Text>
          </button>
        </div>
      )}
      {status === 'ready' && (
        <>
          <p class="profile-uid"><Text>{uid}</Text></p>
          <p class="profile-note"><Text>{t('profile.qrHint')}</Text></p>
        </>
      )}
    </div>
  );
}

export default function QrPage() {
  const t = useT();
  const viewer = useViewer();
  // 本頁不載入 profile 或 activities，不建立 img、不呼叫 QR 圖片服務。
  // useViewer 本身的既有身分查詢與 qrcode 本機 chunk 載入不屬 QR 圖片請求。
  return (
    <Page back title={t('profile.qr')}>
      {viewer.uid ? <IdentityCanvas key={viewer.uid} uid={viewer.uid} /> : <LoginGuide />}
    </Page>
  );
}
