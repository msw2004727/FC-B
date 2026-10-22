// 照 A pages/profile.html#social-link-modal（`profile-card.js#openSocialLinkModal`／`saveSocialLink`／`clearSocialLink`）。
// DOM、class、id、inline style 逐字對齊 A；資料層呼叫 `saveSocialLink`／`clearSocialLink`。
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';

import {
  clearSocialLink,
  normalizeLineContactUrl,
  saveSocialLink,
} from '../../data/profile-writes';
import type { Platform } from '../../ui/shared';

// ASSUMPTION: A `_socialPlatforms` 定義未在附件中；依 SVG keys（threads/yt/twitter/line）與常見平台名推定。
// 前綴固定走 https，不接受由使用者輸入推導；組出的 href 只出現在顯示層（socialHref）與此處 prefix。
export interface SocialPlatformMeta {
  name: string;
  prefix: string;
}

const SOCIAL_PLATFORM_META: Record<string, SocialPlatformMeta> = {
  ig: { name: 'Instagram', prefix: 'https://www.instagram.com/' },
  fb: { name: 'Facebook', prefix: 'https://www.facebook.com/' },
  threads: { name: 'Threads', prefix: 'https://www.threads.net/@' },
  yt: { name: 'YouTube', prefix: 'https://www.youtube.com/@' },
  twitter: { name: 'X', prefix: 'https://twitter.com/' },
  line: { name: 'LINE', prefix: 'https://line.me/ti/p/' },
};

export function socialPlatformMeta(platform: string): SocialPlatformMeta {
  return SOCIAL_PLATFORM_META[platform] ?? { name: platform, prefix: '' };
}

/**
 * LINE 儲存格式為 full URL（見 profile-writes.normalizeLineContactUrl）；輸入框顯示去掉前綴後的 ID。
 * 非 LINE 平台直接顯示儲存的原始 ID。
 */
export function socialInputValue(platform: Platform, stored: string): string {
  const raw = stored.trim();
  if (!raw) return '';
  if (platform !== 'line') return raw;
  const lineMeta = SOCIAL_PLATFORM_META['line'];
  if (!lineMeta) return raw;
  const prefix = lineMeta.prefix;
  if (raw.toLowerCase().startsWith(prefix.toLowerCase())) {
    const id = raw.substring(prefix.length);
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }
  return raw;
}

/**
 * R-CODE-002：拒絕危險協定。LINE 依 A normalizeLineContactUrl 允許 `https://`／`line://`；
 * 其他平台一律拒絕任何協定與 `//` 開頭的輸入，避免將 `javascript:` 等存入 profile。
 */
export function isSafeSocialInput(platform: Platform, raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (platform === 'line') {
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed)) {
      return /^https?:\/\//i.test(trimmed) || /^line:\/\//i.test(trimmed);
    }
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed)) return false;
  if (trimmed.startsWith('//')) return false;
  return true;
}

/** 依 saveSocialLink 的 normalize 規則，回傳要放進本機快照的 stored 值。 */
function storedValue(platform: Platform, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (platform === 'line') return normalizeLineContactUrl(trimmed);
  return trimmed;
}

export interface LegacySocialLinkModalProps {
  uid: string;
  platform: Platform;
  socialLinks: Record<string, unknown>;
  onClose: () => void;
  onSaved: (patch: Record<string, unknown>) => void;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function LegacySocialLinkModal(props: LegacySocialLinkModalProps): JSX.Element {
  const { uid, platform, socialLinks, onClose, onSaved } = props;
  const lt = useLegacyT();
  const meta = socialPlatformMeta(platform);
  const currentValue = stringValue(socialLinks[platform]);

  const [value, setValue] = useState(() => socialInputValue(platform, currentValue));
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);

  const aliveRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    aliveRef.current = true;
    const unlock = lockBody(document.body);
    const releaseBack = pushOverlay(() => {
      onCloseRef.current();
      return true;
    });
    const handleKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      aliveRef.current = false;
      releaseBack();
      unlock();
      document.removeEventListener('keydown', handleKey, true);
    };
  }, []);

  function commitClear(): void {
    if (pending) return;
    setInvalid(false);
    setPending(true);
    clearSocialLink(uid, platform)
      .then(() => {
        if (!aliveRef.current) return;
        onSaved({ socialLinks: { ...socialLinks, [platform]: '' } });
        toast.show({ message: lt('社群連結已清除', '社群連結已清除') });
        onCloseRef.current();
      })
      .catch(() => {
        if (!aliveRef.current) return;
        toast.show({ message: lt('儲存失敗，請稍後再試。', '儲存失敗，請稍後再試。') });
        setPending(false);
      });
  }

  function commitSave(raw: string): void {
    if (pending) return;
    if (!isSafeSocialInput(platform, raw)) {
      setInvalid(true);
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      commitClear();
      return;
    }
    setInvalid(false);
    setPending(true);
    saveSocialLink(uid, platform, trimmed)
      .then(() => {
        if (!aliveRef.current) return;
        onSaved({ socialLinks: { ...socialLinks, [platform]: storedValue(platform, trimmed) } });
        toast.show({ message: lt('社群連結已儲存', '社群連結已儲存') });
        onCloseRef.current();
      })
      .catch(() => {
        if (!aliveRef.current) return;
        toast.show({ message: lt('儲存失敗，請稍後再試。', '儲存失敗，請稍後再試。') });
        setPending(false);
      });
  }

  const clearVisible = currentValue.length > 0;

  return createPortal(
    <div class="legacy-ui">
      <div
        class="modal open"
        id="social-link-modal"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          // 照 A：非 `data-no-backdrop-close` modal 可點遮罩關閉。
          onCloseRef.current();
        }}
      >
        <div class="modal-header">
          <h3 id="social-modal-title">{`編輯 ${meta.name} 連結`}</h3>
          <button
            type="button"
            class="modal-close"
            disabled={pending}
            onClick={() => {
              if (!pending) onCloseRef.current();
            }}
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <div class="ce-form">
            <div class="ce-row">
              <label id="social-modal-label">{`你的 ${meta.name} ID`}</label>
              <div class="social-url-row">
                <span class="social-url-prefix" id="social-url-prefix">{meta.prefix}</span>
                <input
                  type="text"
                  id="social-link-input"
                  placeholder="your_id"
                  value={value}
                  disabled={pending}
                  onInput={(event) => setValue(event.currentTarget.value)}
                />
              </div>
            </div>
          </div>
        </div>
        {invalid && (
          <p role="alert" class="fl-field-hint">
            {lt('請輸入有效的帳號 ID', '請輸入有效的帳號 ID')}
          </p>
        )}
        <div class="modal-actions">
          <button
            type="button"
            class="outline-btn"
            id="social-clear-btn"
            disabled={pending}
            onClick={commitClear}
            style={{
              color: 'var(--danger)',
              borderColor: 'var(--danger)',
              ...(clearVisible ? {} : { display: 'none' }),
            }}
          >
            {lt('清除', '清除')}
          </button>
          <button
            type="button"
            class="primary-btn"
            disabled={pending}
            onClick={() => commitSave(value)}
          >
            {pending ? lt('儲存中...', '儲存中...') : lt('儲存', '儲存')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
