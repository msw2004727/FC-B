import { copyToClipboard } from './activity-share';
import {
  buildEventFlexMessage,
  buildEventLiffUrl,
  buildEventShareAltText,
  buildEventShareOgUrl,
  type ShareBuilderContext,
  type ShareEvent,
} from './event-share-builders';
import type { ShareChoice } from '../components/legacy/ShareActionSheet';

type Liff = typeof import('@line/liff').default;
export type ShareLiff = Pick<Liff, 'isLoggedIn' | 'isApiAvailable' | 'shareTargetPicker'>;

interface ShareOptions extends ShareBuilderContext {
  loggedIn: boolean;
  signal: AbortSignal;
  showToast: (message: string) => void;
}

interface ShareDependencies {
  loadLiff: () => Promise<ShareLiff | null>;
  showSheet: (canPicker: boolean, signal: AbortSignal) => Promise<ShareChoice>;
  copy: (text: string) => Promise<boolean>;
  nativeShare: ((data: ShareData) => Promise<void>) | undefined;
  openLine: (text: string) => void;
}

let shareInProgress = false;

// 照 A _canUseShareTargetPicker；沿用 auth.ts 的 SDK singleton，不重新 init。
export async function loadShareLiff(): Promise<Liff | null> {
  try {
    return (await import('@line/liff')).default;
  } catch {
    return null;
  }
}

export function canUseShareTargetPicker(liff: ShareLiff | null): boolean {
  try {
    // 照 A LineAuth.hasLiffSession（liff.isLoggedIn()）＋ _canUseShareTargetPicker。
    return Boolean(
      liff?.isLoggedIn()
      && liff.isApiAvailable
      && liff.isApiAvailable('shareTargetPicker'),
    );
  } catch {
    return false;
  }
}

function dependencies(): ShareDependencies {
  return {
    loadLiff: loadShareLiff,
    showSheet: async (canPicker, signal) => {
      const module = await import('../components/legacy/ShareActionSheet');
      if (signal.aborted) return 'cancel';
      return module.showShareActionSheet(canPicker, signal);
    },
    copy: copyToClipboard,
    nativeShare: typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      ? (data) => navigator.share(data)
      : undefined,
    openLine: (text) => {
      window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank');
    },
  };
}

// 照 A shareEvent／_doShareEvent。
export async function shareEvent(
  event: ShareEvent,
  options: ShareOptions,
  overrides: Partial<ShareDependencies> = {},
): Promise<void> {
  if (shareInProgress || options.signal.aborted) return;
  shareInProgress = true;
  const deps = { ...dependencies(), ...overrides };
  const current = (): boolean => !options.signal.aborted;
  const notify = (message: string): void => {
    if (current()) options.showToast(message);
  };

  try {
    const url = buildEventLiffUrl(event.id || '');
    const altText = buildEventShareAltText(event, url, options.heat);
    const liff = await deps.loadLiff();
    if (!current()) return;
    const canPicker = canUseShareTargetPicker(liff);

    if (canPicker || options.loggedIn) {
      const choice = await deps.showSheet(canPicker, options.signal);
      if (!current()) return;

      if (choice === 'line') {
        if (!canPicker || !liff || !canUseShareTargetPicker(liff)) {
          notify('請在 LINE 中開啟以使用此功能');
          return;
        }
        try {
          const result = await liff.shareTargetPicker([{
            type: 'flex',
            altText,
            contents: buildEventFlexMessage(event, url, options),
          }]);
          notify(result ? '活動已分享到 LINE' : '分享已完成');
        } catch {
          notify('分享失敗，請稍後再試');
        }
        return;
      }
      if (choice === 'line-share') {
        deps.openLine(altText);
        return;
      }
      if (choice === 'copy') {
        const text = buildEventShareAltText(
          event,
          buildEventShareOgUrl(event.id || ''),
          options.heat,
        );
        const ok = await deps.copy(text);
        notify(ok ? '連結已複製' : '複製失敗');
      }
      return;
    }

    if (deps.nativeShare) {
      try {
        await deps.nativeShare({ text: altText });
        return;
      } catch (error) {
        if (
          error && typeof error === 'object'
          && 'name' in error && error.name === 'AbortError'
        ) return;
      }
    }
    if (!current()) return;
    const ok = await deps.copy(altText);
    notify(ok ? '分享內容已複製到剪貼簿' : '複製失敗，請手動複製');
  } catch {
    notify('分享失敗，請稍後再試');
  } finally {
    shareInProgress = false;
  }
}
