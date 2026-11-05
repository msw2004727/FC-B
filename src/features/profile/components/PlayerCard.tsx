/**
 * T-092 球員卡（DOM）：只負責畫面，數字一律來自 buildPlayerCardModel（與 PNG 產圖同一份）。
 * 三格保留 A 的 `.profile-stats .stat-item` 與 `#profile-stat-*` id，既有個人頁測試與 A 對照仍可用。
 */
import type { ComponentChildren, JSX } from 'preact';
import { useTheme } from '@/core/theme';
import { useT } from '@/i18n/i18n';
import {
  PLAYER_CARD_ABBR,
  PLAYER_CARD_DOM_SCALE,
  playerCardLogoUrl,
  playerCardShineCssGradient,
  playerCardShineGeometry,
  playerCardShineTransform,
  resolvePlayerCardTheme,
  type PlayerCardModel,
  type PlayerCardTheme,
} from '../data/player-card-model';
import './player-card.css';

/** 固定斜光（與 PNG 同一組常數，無動畫）的 inline 樣式；寬高以網頁顯示倍率換算。 */
export function playerCardShineStyle(theme: PlayerCardTheme): string {
  const g = playerCardShineGeometry();
  const width = +(g.bandWidth * PLAYER_CARD_DOM_SCALE).toFixed(3);
  const height = Math.ceil(g.length * PLAYER_CARD_DOM_SCALE);
  return [
    `width:${width}px`,
    `height:${height}px`,
    `background:${playerCardShineCssGradient(theme)}`,
    `transform:${playerCardShineTransform()}`,
  ].join(';');
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
  useTheme(); // 深淺色切換時重畫 logo 與斜光
  const theme = resolvePlayerCardTheme();
  const gaugeWidth = `${Math.round(model.gaugeRatio * 100)}%`;

  return (
    <div class="player-card" data-theme-variant={theme}>
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
      <div class="player-card-shine" aria-hidden="true" style={playerCardShineStyle(theme)} />
    </div>
  );
}
