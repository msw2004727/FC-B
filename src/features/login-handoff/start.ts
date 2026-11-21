import { armWaitForPending, showWaitForPending, waitHandlers } from './claim';
import { HANDOFF_TTL_MS, clearPending, readPending, writePending } from './pending';
import { pairingNumber, sha256Hex } from './pairing';
import { renderWait } from './view';

export async function beginLoginHandoff(cleanRedirectUri: string): Promise<string | null> {
  const existing = readPending();
  if (existing && Date.now() - existing.createdAt < HANDOFF_TTL_MS) {
    await showWaitForPending();
    return null;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = bytesToHex(bytes);
  const handoffId = await sha256Hex(secret);
  const createdAt = Date.now();
  writePending({ secret, createdAt });
  // 根因 1（站長 11-20 實機）：主畫面 App 換到 access.line.me 會被內嵌瀏覽器頁蓋住，數字一閃就看不到。
  // 先停在「記住這個數字」畫面，使用者按「前往 LINE 登入」才回傳網址讓呼叫端 liff.login。
  const go = await waitForGo(await pairingNumber(handoffId), createdAt + HANDOFF_TTL_MS);
  if (!go) {
    clearPending();
    renderWait(null, NOOP_HANDLERS);
    return null;
  }
  if (Date.now() >= createdAt + HANDOFF_TTL_MS) {
    // 停在記數字畫面超過 5 分鐘才按前往：顯示逾時，讓使用者重新登入（Flash 交叉審 P3）。
    clearPending();
    renderWait({ kind: 'timeout' }, waitHandlers);
    return null;
  }
  await armWaitForPending();
  const url = new URL(cleanRedirectUri);
  url.searchParams.set('fcbHandoff', handoffId);
  return url.toString();
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const NOOP = (): void => undefined;
const NOOP_HANDLERS = { onDone: NOOP, onRestart: NOOP, onRetry: NOOP, onClose: NOOP };

/** 畫「記住這個數字」並等使用者選擇：前往 → true；取消、關閉、返回鍵 → false。 */
function waitForGo(number: number, expiresAt: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (go: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(go);
    };
    renderWait({ kind: 'ready', number, expiresAt }, {
      onGo: () => done(true),
      onClose: () => done(false),
      onRestart: () => done(false),
      onDone: NOOP,
      onRetry: NOOP,
    });
  });
}
