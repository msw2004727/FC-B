import type { JSX } from 'preact';
import { lt } from '@/i18n/i18n';
import { SPORTS } from '@/features/events/data/sports';
import {
  getTeamCategoryMeta,
  getTeamCoverImageUrl,
  getTeamThemeColor,
} from '../../data/team-list-model';
import type { TeamCategoryKey, TeamDoc } from '../../data/types';

export interface LegacyTeamCardProps {
  team: TeamDoc;
  onSelect: (teamId: string) => void;
  /** M-115：150ms 後才為 true；進度條 DOM 在這時才輸出。 */
  isPending?: boolean;
  /** 由列表頁管理的偽進度（0–85），套在 .tc-loading-fill 的 width。 */
  pendingProgress?: number;
}

const CATEGORY_LABELS: Record<TeamCategoryKey, string> = {
  none: '',
  competitive: '競技',
  education: '教學',
  leisure: '休閒',
};

function normalizeAttentionColor(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#fbbf24';
}

function sanitizeHttpImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function getSportLabel(sportTag: string | undefined): string {
  const key = String(sportTag ?? '').trim();
  if (!key) return '';
  return SPORTS.find((s) => s.sportTag === key)?.label ?? '';
}

/**
 * C1 乙案「單列」俱樂部卡：縮圖（無圖用首字色塊）＋名稱＋「運動 · 地區 · 人數」＋類型標籤。
 * 拿掉 EXP 徽章（SHOW_EXP=false）、斜緞帶、「俱樂部圖片」佔位字、成員／地區欄名與載入面板說明句（R-UI-026）。
 * 置頂、光跡、主題色、點卡載入條的行為與資料欄位不變。
 */
export function LegacyTeamCard({
  team,
  onSelect,
  isPending = false,
  pendingProgress = 0,
}: LegacyTeamCardProps): JSX.Element {
  const teamId = String(team.id || team._docId || '').trim();
  const pinnedClass = team.pinned ? ' tc-pinned' : '';
  const categoryMeta = getTeamCategoryMeta(team);
  const categoryLabel = CATEGORY_LABELS[categoryMeta.key] || '';

  const attentionEnabled = team.attentionEffectEnabled === true;
  const attentionClass = attentionEnabled ? ' tc-attention-effect' : '';
  const attentionColor = normalizeAttentionColor(team.attentionEffectColor);
  const themeColor = getTeamThemeColor(team).toLowerCase();
  const themeClass = themeColor ? ' tc-themed' : '';

  const styleVars: Record<string, string> = {};
  if (attentionEnabled) {
    styleVars['--tc-attention-color'] = attentionColor;
  }
  if (themeColor) {
    styleVars['--team-theme-color'] = themeColor;
  }

  const rawCardImage = getTeamCoverImageUrl(team, 'card');
  const cardImage = sanitizeHttpImageUrl(rawCardImage);
  const memberCount = typeof team.members === 'number' && Number.isFinite(team.members)
    ? team.members
    : 0;
  const name = team.name ?? '';
  const initial = name.trim().charAt(0) || 'T';
  const region = String(team.region ?? '').trim();
  const meta = [
    getSportLabel(team.sportTag),
    region ? lt(region, region) : '',
    `${memberCount} ${lt('人', '人')}`,
  ].filter(Boolean).join(' · ');

  const handleActivate = (): void => {
    if (!teamId) return;
    onSelect(teamId);
  };

  const loadingBar = isPending ? (
    <div class="tc-loading-bar">
      <div class="tc-loading-fill" style={{ width: `${pendingProgress}%` }} />
    </div>
  ) : null;

  return (
    <div
      class={`tc-card tc-row${pinnedClass}${attentionClass}${themeClass}${isPending ? ' is-pending' : ''}`}
      style={Object.keys(styleVars).length > 0 ? styleVars : undefined}
      data-team-id={teamId}
      role="link"
      tabIndex={0}
      aria-label={team.name || '未命名俱樂部'}
      aria-busy={isPending ? 'true' : undefined}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      <div class={`tc-card-media tc-row-thumb${cardImage ? '' : ' tc-img-placeholder'}`}>
        {cardImage ? (
          <img
            src={cardImage}
            alt=""
            width={104}
            height={104}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span class="tc-row-initial" aria-hidden="true">{initial}</span>
        )}
        {loadingBar}
      </div>
      <div class="tc-row-main">
        <div class="tc-name">{name}</div>
        <div class="tc-row-meta">{meta}</div>
      </div>
      {team.pinned || categoryLabel ? (
        <div class="tc-row-side">
          {team.pinned && (
            <div class="tc-pin-rail" aria-label="置頂俱樂部">
              <span class="tc-pin-mark" aria-hidden="true" />
              <span>置頂</span>
            </div>
          )}
          {categoryLabel ? (
            <span class={`tc-row-tag tc-row-tag-${categoryMeta.key}`}>{categoryLabel}</span>
          ) : null}
        </div>
      ) : null}
      {isPending && <span class="tc-loading-spinner tc-row-spinner" aria-hidden="true" />}
    </div>
  );
}
