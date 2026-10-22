// 卡 1D-2：個人頁「LINE 推播通知」卡（照 A `pages/profile.html#164-213` +
//   `profile-data.js#renderLineNotifyCard`／`bindLineNotify`／`unbindLineNotify`／`toggleLineNotify`）。
//
// - 綁定流程直接呼叫 `line-notify-bind.ts#bindLineNotify`（首次 window.open 在其同步階段），
//   本卡不重寫綁定或經驗值邏輯。
// - 開關／解除只寫 `users/{uid}.lineNotify` + `updatedAt`，透過 `saveLineNotify`。
// - legacy 畫面：inline style 與 A 一致；可見文字一律 `lt()`。
//
// fix-1：畫面狀態由最新 props.profile['lineNotify'] 推導；只有寫入進行中疊加樂觀值，
//   寫入完成或失敗即清掉。切換時以原始 lineNotify 為基準，不覆寫其他欄位。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import {
  bindLineNotify,
  buildLineNotifyPayload,
} from '@/features/events/data/line-notify-bind';
import { lt } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import type { UserProfile } from '../../data/profile-model';
import {
  buildToggledLineNotifyFromRaw,
  buildUnboundLineNotify,
  readLineNotify,
  saveLineNotify,
  type LineNotifyKey,
  type LineNotifyState,
} from '../../data/line-notify-settings';
import { ProfileInfoButton } from './ProfileInfoButton';

const LINE_TOGGLE_ROWS: ReadonlyArray<{ key: LineNotifyKey; text: string }> = [
  { key: 'activity', text: '活動提醒（報名成功/開始前）' },
  { key: 'system', text: '系統通知（站內信/公告）' },
  { key: 'tournament', text: '賽事通知（報名/賽程更新）' },
];

/** 照 A `toggleLineNotify` 的 labels。 */
const TOGGLE_LABELS: Record<LineNotifyKey, string> = {
  activity: '活動提醒',
  system: '系統通知',
  tournament: '賽事通知',
};

const LINE_SVG_PATH =
  'M12 2C6.48 2 2 5.83 2 10.5c0 4.18 3.66 7.68 8.58 8.38.33.07.78.22.9.5.1.26.07.66.03.92l-.15.86c-.04.26-.2 1.01.88.55s5.88-3.47 8.03-5.93C22.08 13.79 22 12.18 22 10.5 22 5.83 17.52 2 12 2z';

export function LegacyLineNotifyCard({
  uid,
  profile,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  onSaved: (patch: Record<string, unknown>) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [binding, setBinding] = useState(false);
  const [pendingKey, setPendingKey] = useState<LineNotifyKey | null>(null);
  const [unbinding, setUnbinding] = useState(false);
  const [optimistic, setOptimistic] = useState<LineNotifyState | null>(null);
  const [fade, setFade] = useState<{ bound?: boolean; unbound?: boolean }>({});

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  // A 綁定/解除後加 `fadeIn` class（.35s 動畫）；播完即移除，以便下次可再播。
  function triggerFade(kind: 'bound' | 'unbound'): void {
    if (fadeTimerRef.current !== null) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setFade({ [kind]: true });
    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = null;
      if (mountedRef.current) setFade({});
    }, 500);
  }

  const displayName = (() => {
    const v = profile['displayName'];
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  })();

  // 畫面以最新 props 推導；寫入進行中才用樂觀值覆蓋。
  const view = optimistic ?? readLineNotify(profile);
  const displayNameText = displayName || '-';
  const boundAtText = view.boundAt || '-';

  function handleToggleOpen(): void {
    setOpen((prev) => !prev);
  }

  function handleHeaderKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }

  function handleBind(): void {
    if (binding) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBinding(true);

    // 同步呼叫：bindLineNotify 第一步即 window.open；handler 前不得 await。
    bindLineNotify(uid, displayName || undefined, {
      signal: controller.signal,
      notify: (message) => {
        toast.show({ message });
      },
    })
      .then(() => {
        if (!mountedRef.current) return;
        const payload = buildLineNotifyPayload().lineNotify;
        onSaved({ lineNotify: payload });
        triggerFade('bound');
      })
      .catch(() => {
        if (!mountedRef.current) return;
        toast.show({
          message: lt('綁定失敗，請稍後再試', '綁定失敗，請稍後再試'),
          tone: 'error',
        });
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setBinding(false);
        abortRef.current = null;
      });
  }

  async function handleToggle(key: LineNotifyKey, input?: HTMLInputElement): Promise<void> {
    // 受控 checkbox 被擋下或寫入失敗時，Preact 不會把 DOM 勾選狀態改回來，要手動設回（review-lessons／T-013）。
    const restoreInput = (): void => {
      if (input) input.checked = !!readLineNotify(profile).settings[key];
    };
    if (pendingKey !== null) { restoreInput(); return; }
    // 照 A `toggleLineNotify`：未綁定直接 return；以最新 profile 為基準。
    const current = readLineNotify(profile);
    if (!current.bound) { restoreInput(); return; }

    const raw = profile['lineNotify'];
    const nextRaw = buildToggledLineNotifyFromRaw(raw, key);
    if (!nextRaw) { restoreInput(); return; }

    const optimisticState = readLineNotify({ lineNotify: nextRaw });
    setOptimistic(optimisticState);
    setPendingKey(key);

    try {
      await saveLineNotify(uid, nextRaw);
      if (!mountedRef.current) return;
      onSaved({ lineNotify: nextRaw });
      const label = TOGGLE_LABELS[key];
      const message = optimisticState.settings[key]
        ? lt('已開啟{label}', '已開啟{label}', { label })
        : lt('已關閉{label}', '已關閉{label}', { label });
      toast.show({ message });
    } catch (err) {
      if (!mountedRef.current) return;
      // 照 A：寫入失敗無提示；B 僅 console.warn 並由清掉樂觀值還原開關。
      // eslint-disable-next-line no-console
      console.warn('[line-notify] toggle failed', err);
      restoreInput();
    } finally {
      if (mountedRef.current) {
        setOptimistic(null);
        setPendingKey(null);
      }
    }
  }

  async function handleUnbind(): Promise<void> {
    if (unbinding) return;
    const ok = await appConfirm(
      lt(
        '確定要解除 LINE 綁定嗎？解除後將無法收到推播通知。',
        '確定要解除 LINE 綁定嗎？解除後將無法收到推播通知。',
      ),
    );
    if (!ok) return;
    if (!mountedRef.current) return;

    setUnbinding(true);
    const payload = buildUnboundLineNotify();
    setOptimistic(readLineNotify({ lineNotify: payload }));
    try {
      await saveLineNotify(uid, payload);
      if (!mountedRef.current) return;
      onSaved({ lineNotify: payload });
      triggerFade('unbound');
      toast.show({ message: lt('已解除 LINE 綁定', '已解除 LINE 綁定') });
    } catch {
      if (!mountedRef.current) return;
      toast.show({
        message: lt('解除綁定失敗，請稍後再試', '解除綁定失敗，請稍後再試'),
        tone: 'error',
      });
    } finally {
      if (mountedRef.current) {
        setUnbinding(false);
        setOptimistic(null);
      }
    }
  }

  return (
    <div class="info-card" id="profile-line-notify">
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open ? 'true' : 'false'}
        onClick={handleToggleOpen}
        onKeyDown={handleHeaderKeyDown}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <ProfileInfoButton infoKey="lineNotify" />
          <span data-i18n="profile.lineNotify">
            {lt('profile.lineNotify', 'LINE 推播通知')}
          </span>{' '}
          <span
            class={`line-notify-status ${view.bound ? 'bound' : 'unbound'}`}
            id="line-notify-badge"
          >
            {view.bound ? lt('已綁定', '已綁定') : lt('未綁定', '未綁定')}
          </span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>

      <div
        class="profile-collapse-content"
        style={open ? undefined : 'display:none'}
      >
        {/* 已綁定 */}
        <div
          id="line-notify-bound"
          class={fade.bound ? 'fadeIn' : undefined}
          style={view.bound ? undefined : 'display:none'}
        >
          <div class="line-notify-row">
            <span data-i18n="LINE 帳號">{lt('LINE 帳號', 'LINE 帳號')}</span>
            <span id="line-notify-name">{displayNameText}</span>
          </div>
          <div class="line-notify-row">
            <span data-i18n="綁定時間">{lt('綁定時間', '綁定時間')}</span>
            <span id="line-notify-time">{boundAtText}</span>
          </div>
          <div style="border-top:1px solid var(--border);margin:.5rem 0"></div>
          <div
            style="font-size:.78rem;font-weight:600;margin-bottom:.35rem"
            data-i18n="通知設定"
          >
            {lt('通知設定', '通知設定')}
          </div>
          {LINE_TOGGLE_ROWS.map((row) => (
            <div class="line-notify-row" key={row.key}>
              <span>
                {row.text}
                <span class="line-notify-sub"></span>
              </span>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  id={`line-toggle-${row.key}`}
                  checked={!!view.settings[row.key]}
                  disabled={pendingKey === row.key}
                  onChange={(e) => {
                    handleToggle(row.key, e.currentTarget).catch(() => {});
                  }}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          ))}
          <div style="text-align:center;margin-top:.7rem">
            <button
              type="button"
              class="outline-btn"
              style="color:var(--danger);border-color:var(--danger);font-size:.75rem;padding:.3rem .8rem"
              disabled={unbinding}
              data-i18n="解除綁定"
              onClick={() => {
                handleUnbind().catch(() => {});
              }}
            >
              {lt('解除綁定', '解除綁定')}
            </button>
          </div>
        </div>

        {/* 未綁定 */}
        <div
          id="line-notify-unbound"
          class={fade.unbound ? 'fadeIn' : undefined}
          style={view.bound ? 'display:none' : undefined}
        >
          <div class="line-notify-empty">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="#06C755"
              style="margin-bottom:.5rem"
            >
              <path d={LINE_SVG_PATH} />
            </svg>
            <div>
              綁定 LINE 帳號並加入官方好友後
              <br />
              即可接收活動提醒與系統通知推播
            </div>
          </div>
          <div style="display:flex;justify-content:center;padding-bottom:.3rem">
            <button
              type="button"
              class={`line-login-btn${binding ? ' loading' : ''}`}
              disabled={binding}
              onClick={handleBind}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                <path d={LINE_SVG_PATH} />
              </svg>
              {lt('綁定 LINE 帳號', '綁定 LINE 帳號')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
