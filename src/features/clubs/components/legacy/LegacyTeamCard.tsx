import type { JSX } from 'preact';
import { lt } from '@/i18n/i18n';
import { SPORTS } from '@/features/events/data/sports';
import {
  getTeamCategoryMeta,
  getTeamCoverImageUrl,
  getTeamRank,
  getTeamThemeColor,
} from '../../data/team-list-model';
import type { TeamCategoryKey, TeamDoc } from '../../data/types';

export interface LegacyTeamCardProps {
  team: TeamDoc;
  onSelect: (teamId: string) => void;
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

function getSportSymbol(sportTag: string | undefined): string {
  const key = String(sportTag ?? '').trim();
  if (!key) return '';
  return SPORTS.find((s) => s.sportTag === key)?.symbol ?? '';
}

export function LegacyTeamCard({ team, onSelect }: LegacyTeamCardProps): JSX.Element {
  const teamId = String(team.id || team._docId || '').trim();
  const pinnedClass = team.pinned ? ' tc-pinned' : '';
  const rank = getTeamRank(team.teamExp);
  const categoryMeta = getTeamCategoryMeta(team);
  const categoryLabel = CATEGORY_LABELS[categoryMeta.key] || '';
  const hasCategoryRibbon = Boolean(categoryMeta.ribbonClass && categoryLabel);
  const categoryRibbonClass =
    hasCategoryRibbon && categoryMeta.key === 'education'
      ? `tc-type-ribbon tc-edu-ribbon ${categoryMeta.ribbonClass}`
      : hasCategoryRibbon
        ? `tc-type-ribbon ${categoryMeta.ribbonClass}`
        : '';

  const sportSymbol = getSportSymbol(team.sportTag);
  const attentionEnabled = team.attentionEffectEnabled === true;
  const attentionClass = attentionEnabled ? ' tc-attention-effect' : '';
  const attentionColor = normalizeAttentionColor(team.attentionEffectColor);
  const themeColor = getTeamThemeColor(team).toLowerCase();
  const themeOverlayEnabled = !themeColor || team.themeOverlayEnabled !== false;
  const themeClass = themeColor
    ? ` tc-themed${themeOverlayEnabled ? '' : ' tc-theme-no-overlay'}`
    : '';

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
  const expText = (team.teamExp ?? 0).toLocaleString();

  const handleActivate = (): void => {
    if (!teamId) return;
    onSelect(teamId);
  };

  return (
    <div
      class={`tc-card${pinnedClass}${attentionClass}${themeClass}`}
      style={Object.keys(styleVars).length > 0 ? styleVars : undefined}
      data-team-id={teamId}
      role="link"
      tabIndex={0}
      aria-label={team.name || '未命名俱樂部'}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      {team.pinned && (
        <div class="tc-pin-rail" aria-label="置頂俱樂部">
          <span class="tc-pin-mark" aria-hidden="true" />
          <span>置頂</span>
        </div>
      )}
      {cardImage ? (
        <div class="tc-card-media">
          {sportSymbol && (
            <span class="tc-sport-badge">
              <span class="sport-emoji" aria-hidden="true">{sportSymbol}</span>
            </span>
          )}
          <img
            src={cardImage}
            alt=""
            width={1000}
            height={1000}
            loading="lazy"
            decoding="async"
          />
          <span class="tc-rank-badge" style={{ color: rank.color }}>
            <span class="tc-rank-score">{expText}</span>
            {rank.rank}
          </span>
          {hasCategoryRibbon && (
            <span class={categoryRibbonClass}>{categoryLabel}</span>
          )}
        </div>
      ) : (
        <div class="tc-card-media tc-img-placeholder">
          {sportSymbol && (
            <span class="tc-sport-badge">
              <span class="sport-emoji" aria-hidden="true">{sportSymbol}</span>
            </span>
          )}
          俱樂部圖片
          <span class="tc-rank-badge" style={{ color: rank.color }}>
            <span class="tc-rank-score">{expText}</span>
            {rank.rank}
          </span>
          {hasCategoryRibbon && (
            <span class={categoryRibbonClass}>{categoryLabel}</span>
          )}
        </div>
      )}
      <div class="tc-body">
        <div class="tc-name">{team.name ?? ''}</div>
        <div class="tc-info-row">
          <span class="tc-label">{lt('成員', '成員')}</span>
          <span>{`${memberCount} ${lt('人', '人')}`}</span>
        </div>
        <div class="tc-info-row">
          <span class="tc-label">{lt('地區', '地區')}</span>
          <span>{team.region ?? ''}</span>
        </div>
      </div>
    </div>
  );
}
