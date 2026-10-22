import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { lt } from '@/i18n/i18n';
import {
  countTeamRegistrations,
  getSplitTeams,
  getTeamCap,
  getTeamSplit,
  type TeamBatchAction,
  type TeamRegistration,
} from '../../data/team-split';
import {
  canManageTeamSplit,
  type OperateContext,
  type OperateEvent,
} from '../../data/operate-permissions';

const JERSEY_PATH = 'M10 1L1 6.5L4.5 9L5 25C5 26.1 5.9 27 7 27H25C26.1 27 27 26.1 27 25V9L30.5 6.5L22 1C22 1 20 5 16 5C12 5 10 1 10 1Z';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const value = (hex || '').replace(/[^0-9a-fA-F]/g, '');
  if (value.length !== 6) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function darkenHex(hex: string): string {
  if (hex === '#FFFFFF' || hex === '#ffffff') return '#D1D5DB';
  if (hex === '#1F2937' || hex === '#000000') return '#9CA3AF';
  const rgb = parseHex(hex);
  if (!rgb) return '#999999';
  return '#' + [rgb.r, rgb.g, rgb.b]
    .map(value => Math.round(Math.min(255, Math.max(0, value * 0.85)))
      .toString(16).padStart(2, '0'))
    .join('');
}

// 照 A _tsJerseySvg；文字由 JSX 跳脫。
function Jersey({ color, letter, width }: {
  color: string;
  letter: string;
  width: number;
}): JSX.Element {
  const empty = !color || color === 'transparent';
  const safeColor = empty ? 'transparent' : color.replace(/[^#0-9a-fA-F]/g, '');
  const stroke = empty ? '#9CA3AF' : darkenHex(color).replace(/[^#0-9a-fA-F]/g, '');
  const rgb = parseHex(safeColor);
  const light = empty || Boolean(rgb
    && (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > 0.5);
  const label = letter ? `${letter} 隊` : '未分配';
  return (
    <svg
      class="uc-team-jersey"
      style={`position:relative;top:0;right:0;width:${width}px;height:${Math.round(width * 0.875)}px`}
      viewBox="0 0 32 28"
      fill="none"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path
        d={JERSEY_PATH}
        fill={safeColor}
        stroke={stroke}
        stroke-width={empty ? 1.5 : 1}
        stroke-dasharray={empty ? '2 1.5' : undefined}
      />
      {!empty && !light && <circle cx="16" cy="17" r="7" fill="rgba(0,0,0,0.35)" />}
      <text
        x="16"
        y="21"
        text-anchor="middle"
        font-size="12"
        font-weight="700"
        fill={empty ? '#9CA3AF' : light ? '#1F2937' : '#fff'}
      >
        {letter || '?'}
      </text>
    </svg>
  );
}

interface TeamDisplayProps {
  event: object;
  registrations: readonly TeamRegistration[];
}

// 照 A _tsRenderTeamInfoCards。
export function TeamInfoCards({ event, registrations }: TeamDisplayProps): JSX.Element | null {
  if (!getTeamSplit(event)?.enabled) return null;
  const teams = getSplitTeams(event);
  const counts = countTeamRegistrations(teams, registrations);
  const cap = getTeamCap(event);
  return (
    <>
      {teams.map(team => {
        const count = counts[team.key] || 0;
        return (
          <div class="team-stat-card" key={team.key}>
            <Jersey color={team.color} letter={team.key} width={20} />
            {' '}
            <span
              class="team-stat-text"
              style={cap && count > cap ? 'color:var(--warning);font-weight:700' : undefined}
            >
              {count}{cap ? `/${cap}` : ''}{' '}
              <span>{lt('common.person', '人')}</span>
            </span>
          </div>
        );
      })}
    </>
  );
}

// 照 A _tsRenderBatchButtons；顯示與 handler 共用同一 helper。
export function TeamBatchButtons({ event, context, onAction }: {
  event: OperateEvent;
  context: OperateContext;
  onAction: (action: TeamBatchAction) => void;
}): JSX.Element | null {
  if (!getTeamSplit(event)?.enabled || !canManageTeamSplit(context, event)) return null;
  return (
    <div class="team-batch-actions">
      <button type="button" class="batch-btn" onClick={() => onAction('random')}>
        {lt('teamSplit.batch.random', '隨機')}
      </button>
      <button type="button" class="batch-btn" onClick={() => onAction('fill')}>
        {lt('teamSplit.batch.fill', '補齊')}
      </button>
      <button type="button" class="batch-btn" onClick={() => onAction('reset')}>
        {lt('teamSplit.batch.reset', '重置')}
      </button>
    </div>
  );
}

// 照 A _tsRenderTeamSelectUI。
export function TeamSelectUI({
  event,
  registrations,
  selectedKey,
  onSelect,
}: TeamDisplayProps & {
  selectedKey: string | null;
  onSelect: (key: string) => void;
}): JSX.Element | null {
  const [shaking, setShaking] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(timer => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  const split = getTeamSplit(event);
  const teams = getSplitTeams(event);
  if (!split?.enabled || split.mode !== 'self-select' || !teams.length) return null;
  const counts = countTeamRegistrations(teams, registrations);
  const cap = getTeamCap(event);

  function select(key: string, full: boolean): void {
    if (!alive.current) return;
    if (!full) {
      onSelect(key);
      return;
    }
    const previous = timers.current.get(key);
    if (previous !== undefined) clearTimeout(previous);
    setShaking(value => new Set([...value, key]));
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      if (!alive.current) return;
      setShaking(value => {
        const next = new Set(value);
        next.delete(key);
        return next;
      });
    }, 300));
  }

  return (
    <div class="team-select-zone">
      <div class="team-select-title">{lt('teamSplit.select.title', '選擇你的隊伍')}</div>
      <div class="team-select-cards">
        {teams.map(team => {
          const count = counts[team.key] || 0;
          const full = Boolean(cap && count >= cap);
          return (
            <div
              key={team.key}
              class={`team-select-card${selectedKey === team.key ? ' selected' : ''}${full ? ' full' : ''}${shaking.has(team.key) ? ' shake' : ''}`}
              onClick={() => select(team.key, full)}
            >
              <Jersey color={team.color} letter={team.key} width={32} />
              <div class="team-select-name">{team.name || `${team.key} 隊`}</div>
              <div class="team-select-count">
                {count}{cap ? `/${cap}` : ''}{lt('common.person', '人')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
