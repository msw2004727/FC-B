/**
 * T-092 球員卡（DOM）：只負責畫面，數字一律來自 buildPlayerCardModel（與 PNG 產圖同一份）。
 * 三格保留 A 的 `.profile-stats .stat-item` 與 `#profile-stat-*` id，既有個人頁測試與 A 對照仍可用。
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { useTheme } from '@/core/theme';
import { useT } from '@/i18n/i18n';
import {
  PLAYER_CARD_ABBR,
  playerCardLogoUrl,
  resolvePlayerCardTheme,
  type PlayerCardModel,
} from '../data/player-card-model';
import './player-card.css';

export type PlayerCardShineMode = 'sweep' | 'static' | 'paused';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function resolveShineMode(reducedMotion: boolean, hidden: boolean): PlayerCardShineMode {
  if (reducedMotion) return 'static';
  return hidden ? 'paused' : 'sweep';
}

/** 反光：頁面可見才掃光；使用者要求減少動態時改靜態斜光。 */
export function usePlayerCardShine(): PlayerCardShineMode {
  const [mode, setMode] = useState<PlayerCardShineMode>(() =>
    resolveShineMode(prefersReducedMotion(), pageHidden()));

  useEffect(() => {
    const update = (): void => setMode(resolveShineMode(prefersReducedMotion(), pageHidden()));
    update();
    document.addEventListener('visibilitychange', update);
    let mql: MediaQueryList | null = null;
    try {
      mql = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    } catch {
      mql = null;
    }
    if (mql && typeof mql.addEventListener === 'function') mql.addEventListener('change', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      if (mql && typeof mql.removeEventListener === 'function') mql.removeEventListener('change', update);
    };
  }, []);

  return mode;
}

export function PlayerCard({
  model,
  avatar,
}: {
  model: PlayerCardModel;
  /** 頭像節點（沿用 LegacyAvatar，含第二身分皇冠）。 */
  avatar: ComponentChildren;
}): JSX.Element {
  const t = useT();
  useTheme(); // 深淺色切換時重畫 logo
  const theme = resolvePlayerCardTheme();
  const shine = usePlayerCardShine();
  const gaugeWidth = `${Math.round(model.gaugeRatio * 100)}%`;

  return (
    <div class={`player-card is-shine-${shine}`} data-theme-variant={theme}>
      <div class="player-card-frame" aria-hidden="true" />
      <div class="player-card-att">
        <span class="player-card-att-num">{model.attendText}</span>
        <span class="player-card-abbr">{PLAYER_CARD_ABBR.attend}</span>
      </div>
      <div class="player-card-title">
        <span class="player-card-title-zh">{t('profile.playerCard.title')}</span>
        <span class="player-card-abbr">{PLAYER_CARD_ABBR.title}</span>
      </div>

      <div class="player-card-avatar-wrap">
        <div class="player-card-ring">
          <div class="player-card-ring-inner">{avatar}</div>
        </div>
        {model.showClubBadge && (
          <div class={`player-card-club${model.clubBadgeWide ? ' is-wide' : ''}`}>
            <span class="player-card-club-label">{t('profile.playerCard.clubs')}</span>
            <span class="player-card-club-num">{String(model.clubCount)}</span>
          </div>
        )}
      </div>

      <div class="profile-title player-card-name" id="profile-title" data-no-translate>
        <span>{model.name}</span>
      </div>
      <div class="player-card-gauge" aria-hidden="true">
        <div class="player-card-gauge-fill" style={`width:${gaugeWidth}`} />
      </div>

      <div class="profile-stats player-card-stats">
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-total">{model.scheduledText}</span>
          <span class="stat-label">{t('profile.playerCard.scheduled')}</span>
          <span class="player-card-abbr">{PLAYER_CARD_ABBR.scheduled}</span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-done">{model.completedText}</span>
          <span class="stat-label">{t('profile.playerCard.completed')}</span>
          <span class="player-card-abbr">{PLAYER_CARD_ABBR.completed}</span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-rate">{model.attendText}</span>
          <span class="stat-label">{t('profile.playerCard.attendRate')}</span>
          <span class="player-card-abbr">{PLAYER_CARD_ABBR.attend}</span>
        </div>
      </div>

      <img
        class="player-card-logo"
        src={playerCardLogoUrl(theme)}
        alt="ToosterX"
        decoding="async"
        loading="lazy"
      />
    </div>
  );
}
