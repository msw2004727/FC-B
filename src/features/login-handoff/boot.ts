import { beginClaim } from './claim';
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
  const params = readParams();
  if (params.handoffId) {
    if (params.code && params.liffClientId) {
      const pending = readPending();
      if (pending && (await sha256Hex(pending.secret)) === params.handoffId) {
        clearPending();
        try {
          const url = new URL(location.href);
          url.searchParams.delete('fcbHandoff');
          replacePage(url.toString());
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
    return;
  }

  const pending = readPending();
  if (!pending) return;
  if (Date.now() - pending.createdAt > PENDING_DISCARD_MS) {
    clearPending();
    return;
  }
  if (deps.isIosStandalone()) await beginClaim();
}

function readParams(): {
  handoffId: string | null;
  code: string | null;
  liffClientId: string | null;
  liffRedirectUri: string | null;
} {
  try {
    const params = new URL(location.href).searchParams;
    return {
      handoffId: params.get('fcbHandoff'),
      code: params.get('code'),
      liffClientId: params.get('liffClientId'),
      liffRedirectUri: params.get('liffRedirectUri'),
    };
  } catch {
    return { handoffId: null, code: null, liffClientId: null, liffRedirectUri: null };
  }
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
