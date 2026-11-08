import { useState } from 'preact/hooks';

/** 內測站角標只在這個主機出現。正式站 toosterx.com 不渲染、也不讀寫這份紀錄。 */
const DIAG_HOST = 'next.toosterx.com';
const DIAG_KEY = 'fcb:diag-loads';

interface DiagLoad {
  n?: unknown;
  path?: unknown;
  q?: unknown;
  h?: unknown;
  rewrote?: unknown;
}

interface DiagLoadsBadgeProps {
  /** 不傳就看 location.hostname。只有測試會傳。 */
  hostname?: string;
}

function readHostname(): string {
  try {
    return typeof location === 'undefined' ? '' : location.hostname;
  } catch {
    return '';
  }
}

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item !== '' && !names.includes(item)) names.push(item);
  }
  return names;
}

function readDiagLoads(): DiagLoad[] {
  try {
    const raw = sessionStorage.getItem(DIAG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DiagLoad => item !== null && typeof item === 'object');
  } catch {
    return [];
  }
}

/** 只輸出名稱與路徑。不輸出紀錄裡多出來的欄位（那些可能是值）。 */
function diagLoadText(item: DiagLoad): string {
  const n = typeof item.n === 'number' && Number.isFinite(item.n) ? String(item.n) : '?';
  const path = typeof item.path === 'string' ? item.path : '';
  const rewrote = item.rewrote === true ? 'rewrote' : 'kept';
  return `${n} ${path} q:${namesOf(item.q).join(',')} h:${namesOf(item.h).join(',')} ${rewrote}`;
}

/**
 * 內測 LIFF 真機看開頁次數、路徑、查詢與 hash 的參數名稱。
 * 純文字，不碰 innerHTML。點一下收合，避免擋住操作。
 */
export function DiagLoadsBadge({ hostname }: DiagLoadsBadgeProps = {}): JSX.Element | null {
  const [open, setOpen] = useState(true);
  const host = hostname ?? readHostname();
  if (host !== DIAG_HOST) return null;
  const loads = readDiagLoads();
  return (
    <div
      class="fcb-diag-loads"
      style={{
        position: 'fixed',
        right: 'calc(8px + var(--safe-right, 0px))',
        bottom: 'calc(128px + var(--safe-bottom, 0px))',
        zIndex: 210,
        maxWidth: 'min(220px, 46vw)',
        maxHeight: '30vh',
        overflow: 'auto',
        margin: 0,
        padding: '4px 6px',
        borderRadius: '4px',
        background: 'rgba(0, 0, 0, 0.72)',
        color: '#fff',
        font: '11px/1.35 ui-monospace, monospace',
        textAlign: 'left',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'block',
          margin: 0,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        {open ? '收合' : '診斷'}
      </button>
      {open ? (
        <ul style={{ margin: '2px 0 0', padding: 0, listStyle: 'none', overflowWrap: 'anywhere' }}>
          {loads.map((item, index) => (
            <li key={index}>{diagLoadText(item)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
