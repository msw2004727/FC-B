import { beginClaim } from './claim';
import { readHandoffParams, unwrapPageUrl } from './handoff-url';
import { replacePage } from './nav';
import { sha256Hex } from './pairing';
import { PENDING_DISCARD_MS, clearPending, readPending } from './pending';
import { beginRelay } from './relay';

export interface BootDeps {
  isIosStandalone(): boolean;
  isStandalone(): boolean;
  cleanParams(): void;
  suppressAutoLogin(): void;
}

export async function bootLoginHandoff(deps: BootDeps): Promise<void> {
  const params = readHandoffParams(location.href);
  if (params.present) {
    if (params.handoffId && params.code && params.liffClientId) {
      const pending = readPending();
      if (pending && (await sha256Hex(pending.secret)) === params.handoffId) {
        clearPending();
        // 還原 liff.state 包裹、拿掉 fcbHandoff，code 等留著，整頁重載走既有接手。
        const target = unwrapPageUrl(location.href);
        try {
          if (target) replacePage(target.toString());
        } catch {
          /* 換頁失敗仍已清 pending，避免再 claim */
        }
        return;
      }
      if (iosBrowserTab(deps)) {
        const saved = {
          handoffId: params.handoffId,
          code: params.code,
          liffClientId: params.liffClientId,
          liffRedirectUri: params.liffRedirectUri,
        };
        deps.cleanParams();
        deps.suppressAutoLogin();
        await beginRelay(saved);
        return;
      }
    }
    deps.cleanParams();
  }

  const pending = readPending();
  if (!pending) return;
  if (Date.now() - pending.createdAt > PENDING_DISCARD_MS) {
    clearPending();
    return;
  }
  if (deps.isIosStandalone()) await beginClaim();
}


function device(): { ua: string; touch: number } {
  const ua = typeof navigator === 'undefined' ? '' : (navigator.userAgent || '');
  const touch = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0);
  return { ua, touch };
}

function iosFamily(ua: string, touch: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}

function iosBrowserTab(deps: BootDeps): boolean {
  const { ua, touch } = device();
  if (!iosFamily(ua, touch)) return false;
  if (ua.includes('Line/')) return false;
  if (deps.isStandalone()) return false;
  return true;
}
