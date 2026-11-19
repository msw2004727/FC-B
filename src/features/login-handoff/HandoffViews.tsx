// 轉交畫面（站長同意的預覽 v2）：瀏覽器轉交頁 ①②③＋已送出或已失效；主畫面 App 等待框 ④⑤⑥。
// 外框沿用登入提示框的液態玻璃樣式（#mobile-line-login-hint-modal、#modal-overlay.line-login-hint-overlay）。
// 兩者不會同時出現：提示框按下後才發起轉交，且等待框卸載後才可能再開提示框。
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { getCurrentLocale } from '@/i18n/i18n';
import { handoffText, type HandoffText } from './messages';
import type { RelayHandlers, RelayView, WaitHandlers, WaitView } from './view-types';
import './login-handoff.css';

const LINE_PATH = 'M12 3C6.48 3 2 6.58 2 11c0 3.96 3.6 7.27 8.46 7.9.33.07.78.22.89.5.1.26.07.66.03.92l-.14.86c-.04.26-.2 1 .88.55 1.08-.46 5.83-3.43 7.95-5.88C21.53 14.24 22 12.67 22 11c0-4.42-4.48-8-10-8z';

// 只在全形標點後換行（站長規則：文字不被動斷行；顧問 §3.350）。每段 inline-block，段內不拆字；
// 單段比畫面寬時仍會在段內換行，不會溢出。只認全形標點：英、韓、越等以空格分詞的語言照一般換行，
// 若連半形標點也切，下一段開頭的空格會被 inline-block 吃掉（「unstable.Please」）。
// 不用後行斷言（lookbehind 要 Safari 16.4；build target 是 safari14，打包工具不轉寫正規式，舊 iOS 會整檔語法錯誤；顧問 §3.351）。
const SEGMENT = /[^，。、！？；：]+[，。、！？；：]*|[，。、！？；：]+/g;
export function splitSegments(text: string): string[] {
  return text.match(SEGMENT) ?? [text];
}
function Seg({ text }: { text: string }): JSX.Element {
  return <>{splitSegments(text).map((part, i) => <span key={i} class="login-handoff-seg">{part}</span>)}</>;
}

function useOverlayBack(onClose: () => void): void {
  useEffect(() => pushOverlay(() => {
    onClose();
    return true;
  }), [onClose]);
}

function Icon({ kind }: { kind: 'ok' | 'x' | 'clock' | 'phone' }): JSX.Element {
  const common = { width: 52, height: 52, viewBox: '0 0 24 24', fill: 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round' as const, 'aria-hidden': true };
  if (kind === 'ok') {
    return <svg {...common} stroke="#06C755" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>;
  }
  if (kind === 'x') {
    return <svg {...common} stroke="#ef4444"><circle cx="12" cy="12" r="10" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
  }
  if (kind === 'clock') {
    return <svg {...common} stroke="#f59e0b"><circle cx="12" cy="12" r="10" /><path d="M12 7v5l3 2" /></svg>;
  }
  return <svg {...common} stroke="#64748b"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>;
}

function Shell({ title, closeLabel, onClose, children }: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ComponentChildren;
}): JSX.Element {
  useOverlayBack(onClose);
  return (
    <div class={`legacy-ui login-handoff${getCurrentLocale() === 'ko' ? ' login-handoff--ko' : ''}`}>
      <div id="modal-overlay" class="modal-overlay open line-login-hint-overlay" />
      <div
        class="modal open"
        id="mobile-line-login-hint-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-handoff-title"
      >
        <div class="modal-header">
          <h3 id="login-handoff-title">{title}</h3>
          <button class="modal-close" type="button" aria-label={closeLabel} onClick={onClose}>✕</button>
        </div>
        <div class="modal-body line-login-hint-body">{children}</div>
      </div>
    </div>
  );
}

function Primary({ label, line = false, disabled = false, onClick }: {
  label: string;
  line?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" class="line-login-hint-action line-login-hint-open" disabled={disabled} onClick={onClick}>
      {line && (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d={LINE_PATH} /></svg>
      )}
      {label}
    </button>
  );
}

function Secondary({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return <button type="button" class="line-login-hint-cancel" onClick={onClick}>{label}</button>;
}

function remainLabel(text: HandoffText, expiresAt: number, now: number): string {
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return text.remain.replace('{time}', `${m}:${s}`);
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function WaitScreen({ view, handlers }: { view: WaitView; handlers: WaitHandlers }): JSX.Element {
  const text = handoffText(getCurrentLocale());
  // 只有④等待畫面顯示倒數；⑤⑥不必每秒重畫（Flash 交叉審 P3）。
  const now = useNow(view.kind === 'wait');
  if (view.kind === 'timeout') {
    return (
      <Shell title={text.timeoutTitle} closeLabel={text.close} onClose={handlers.onClose}>
        <div class="login-handoff-icon"><Icon kind="clock" /></div>
        <p class="login-handoff-body"><Seg text={text.timeoutBody} /></p>
        <Primary label={text.relogin} line onClick={handlers.onRestart} />
        <Secondary label={text.cancel} onClick={handlers.onClose} />
      </Shell>
    );
  }
  if (view.kind === 'notYet') {
    return (
      <Shell title={text.notYetTitle} closeLabel={text.close} onClose={handlers.onClose}>
        <div class="login-handoff-icon"><Icon kind="clock" /></div>
        <p class="login-handoff-body"><Seg text={text.notYetBody} /></p>
        {/* 站長 11-19 選 B：按鈕與內文「再按一次『我已完成』」一致（取代預覽 v2 的「再試一次」）。 */}
        <Primary label={text.iDone} onClick={handlers.onRetry} />
        <Secondary label={text.relogin} onClick={handlers.onRestart} />
      </Shell>
    );
  }
  return (
    <Shell title={text.waitTitle} closeLabel={text.close} onClose={handlers.onClose}>
      <div class="login-handoff-icon"><Icon kind="phone" /></div>
      <p class="login-handoff-prompt"><Seg text={text.waitPrompt} /></p>
      <div class="login-handoff-big" aria-live="polite">{view.number}</div>
      <p class="login-handoff-note"><Seg text={text.waitNote} /></p>
      <span class="login-handoff-remain">{remainLabel(text, view.expiresAt, now)}</span>
      <Primary label={text.iDone} disabled={view.busy} onClick={handlers.onDone} />
      <Secondary label={text.restart} onClick={handlers.onRestart} />
    </Shell>
  );
}

export function RelayScreen({ view, handlers }: { view: RelayView; handlers: RelayHandlers }): JSX.Element {
  const text = handoffText(getCurrentLocale());
  if (view.kind === 'done' || view.kind === 'sentOrExpired') {
    return (
      <Shell title={text.doneTitle} closeLabel={text.close} onClose={handlers.onClose}>
        <div class="login-handoff-icon"><Icon kind={view.kind === 'done' ? 'ok' : 'phone'} /></div>
        <p class="login-handoff-body"><Seg text={view.kind === 'done' ? text.doneBody : text.sentOrExpired} /></p>
        {view.kind === 'done' && <p class="login-handoff-note"><Seg text={text.doneNote} /></p>}
      </Shell>
    );
  }
  if (view.kind === 'wrong') {
    return (
      <Shell title={text.wrongTitle} closeLabel={text.close} onClose={handlers.onClose}>
        <div class="login-handoff-icon"><Icon kind="x" /></div>
        <p class="login-handoff-body"><Seg text={text.wrongBody} /></p>
        <Secondary label={text.closePage} onClick={handlers.onClose} />
      </Shell>
    );
  }
  return (
    <Shell title={text.pickTitle} closeLabel={text.close} onClose={handlers.onClose}>
      <div class="login-handoff-warn" role="note">
        <span aria-hidden="true">⚠</span>
        <span><Seg text={text.warn} /></span>
      </div>
      <p class="login-handoff-prompt"><Seg text={text.pickPrompt} /></p>
      <div class="login-handoff-nums">
        {view.options.map((n) => (
          <button
            key={n}
            class="login-handoff-num"
            type="button"
            disabled={view.busy}
            onClick={() => handlers.onPick(n)}
          >
            {n}
          </button>
        ))}
      </div>
      {view.tryLater ? (
        <div class="login-handoff-stack">
          <p class="login-handoff-note login-handoff-trylater" role="alert"><Seg text={text.tryLater} /></p>
          <Primary label={text.retry} disabled={view.busy} onClick={handlers.onRetry} />
        </div>
      ) : (
        <p class="login-handoff-note"><Seg text={text.pickNote} /></p>
      )}
      <Secondary label={text.notMe} onClick={handlers.onClose} />
    </Shell>
  );
}
