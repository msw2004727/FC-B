/**
 * T-092 球員卡（DOM）：只負責畫面，數字一律來自 buildPlayerCardModel（與 PNG 產圖同一份）。
 * 三格保留 A 的 `.profile-stats .stat-item` 與 `#profile-stat-*` id，既有個人頁測試與 A 對照仍可用。
 */
import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useTheme } from '@/core/theme';
import { useT } from '@/i18n/i18n';
import {
  PLAYER_CARD_ABBR,
  playerCardLogoUrl,
  playerCardShineCssGradient,
  playerCardShineLayers,
  resolvePlayerCardTheme,
  type PlayerCardModel,
  type PlayerCardShineFace,
  type PlayerCardTheme,
} from '../data/player-card-model';
import { readPlayerCardLocked, usePlayerCardSpin, writePlayerCardLocked } from './player-card-spin';
import './player-card.css';

function LockIcon({ locked }: { locked: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.75-1.4'} />
    </svg>
  );
}

/** 固定斜光（與 PNG 同一組常數，無動畫）：每層一個鋪滿卡面的元素，soft-light 層加 is-soft-light（CSS 設 mix-blend-mode）。 */
function PlayerCardShine({ theme, face }: { theme: PlayerCardTheme; face: PlayerCardShineFace }): JSX.Element {
  return (
    <>
      {playerCardShineLayers(theme, face).map((layer, i) => (
        <div
          key={i}
          class={`player-card-shine${layer.blend === 'soft-light' ? ' is-soft-light' : ''}`}
          aria-hidden="true"
          style={`background:${playerCardShineCssGradient(layer)}`}
        />
      ))}
    </>
  );
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
  const [locked, setLocked] = useState(readPlayerCardLocked);
  const { flipRef, handlers } = usePlayerCardSpin(locked);
  const toggleLock = (): void => {
    const next = !locked;
    setLocked(next);
    writePlayerCardLocked(next);
  };
  const logoUrl = playerCardLogoUrl(theme);

  // 外層留出鎖頭列；只有舞台吃撥動手勢（鎖頭在舞台外，點它不會翻）。正面仍是 .player-card（既有測試與 PNG 對照不變）。
  return (
    <div class="player-card-spin">
      <button
        type="button"
        class={`player-card-lock${locked ? ' is-locked' : ''}`}
        aria-pressed={locked ? 'true' : 'false'}
        aria-label={t('profile.playerCard.lock')}
        onClick={toggleLock}
      >
        <LockIcon locked={locked} />
      </button>
      <div
        class={`player-card-stage${locked ? ' is-locked' : ''}`}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onLostPointerCapture={handlers.onLostPointerCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        <div class="player-card-flip" ref={flipRef}>
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
              src={logoUrl}
              alt="ToosterX"
              draggable={false}
              decoding="async"
              loading="lazy"
            />
            <PlayerCardShine theme={theme} face="front" />
          </div>
          <div class="player-card-back" data-theme-variant={theme} aria-hidden="true">
            <div class="player-card-frame" />
            <img class="player-card-back-logo" src={logoUrl} alt="" draggable={false} decoding="async" loading="lazy" />
            <PlayerCardShine theme={theme} face="back" />
          </div>
        </div>
      </div>
    </div>
  );
}
