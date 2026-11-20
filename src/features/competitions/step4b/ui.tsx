// 預覽共用骨架。主辦後台走平面卡片；球員與公開頁沿用賽事 cps 卡片。

import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Textarea';
import type { S4bMatch } from '../testing/step4b-fixtures';
import { clockLabel } from '../testing/step4b-fixtures';
import { copy } from './copy';
import './step4b.css';

function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function Chevron(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function S4bFrame({
  title,
  admin = false,
  screen,
  context,
  onBack,
  children,
}: {
  title: string;
  admin?: boolean;
  screen: string;
  /** 頁名右邊的賽事名小字（與 CpFrame 的 context 同一個標記與 class）；沒有就不畫。 */
  context?: string;
  onBack?: () => void;
  children: ComponentChildren;
}): JSX.Element {
  const root = admin ? 'cps-root s4b s4b-admin' : 'cps-root s4b';
  return (
    <div class={root} data-screen={screen}>
      <header class="cps-top s4b-noprint">
        <button type="button" class="cps-iconbtn" aria-label={copy.back} onClick={onBack}>
          <BackIcon />
        </button>
        <h1>{title}</h1>
        {context ? <span class="cps-top__ctx">{context}</span> : null}
      </header>
      <div class="cps-stack">{children}</div>
    </div>
  );
}

export function S4bCard({
  plain = false,
  children,
}: {
  plain?: boolean;
  children: ComponentChildren;
}): JSX.Element {
  return <section class={plain ? 's4b-plain' : 'cps-card'}>{children}</section>;
}

export function Line({
  text,
  strong = false,
  fit = false,
  warn = false,
}: {
  text: string;
  strong?: boolean;
  /** 較長的一行用較小字級，360 寬不斷行。 */
  fit?: boolean;
  /** 警示色。文字本身仍要寫出是或否，不能只靠顏色。 */
  warn?: boolean;
}): JSX.Element {
  const i = text.indexOf('：');
  const cls = [
    's4b-line',
    strong ? 's4b-strong' : '',
    fit ? 's4b-line--fit' : '',
    warn ? 's4b-age-no' : '',
  ].filter(Boolean).join(' ');
  if (i < 0) return <p class={cls}><span class="s4b-k">{text}</span></p>;
  return (
    <p class={cls}>
      <span class="s4b-k">{text.slice(0, i + 1)}</span>
      <span class="s4b-v">{text.slice(i + 1)}</span>
    </p>
  );
}

export function MatchBits({ match }: { match: S4bMatch }): JSX.Element {
  const clock = clockLabel(match.kickoffAt);
  return (
    <>
      <span class="s4b-k">{clock.time}</span>
      {clock.nextDay ? <Badge tone="info" size="sm" label={copy.nextDay} /> : null}
      <span class="s4b-k">{match.venue}</span>
    </>
  );
}

export function vsLabel(match: S4bMatch): string {
  return copy.vs(match.home, match.away);
}

/** 有內容時展開；沒內容只放「＋補充說明」。打開後可輸入。 */
export function NoteSlot({ text }: { text: string | null }): JSX.Element {
  const filled = text != null && text.trim().length > 0;
  const [open, setOpen] = useState(filled);
  const [value, setValue] = useState(text ?? '');
  if (!open) {
    return (
      <div class="s4b-mini">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{copy.addNote}</Button>
      </div>
    );
  }
  return <Textarea label={copy.noteLabel} value={value} maxLength={200} rows={2} onValueChange={setValue} />;
}
