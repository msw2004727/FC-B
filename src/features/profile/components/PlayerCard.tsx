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
import {
  PLAYER_CARD_GAUGE_MAX_RPM,
  PLAYER_CARD_RPM_REDLINE,
  readPlayerCardLocked,
  rpmToNeedleDeg,
  usePlayerCardSpin,
  writePlayerCardLocked,
} from './player-card-spin';
import {
  PLAYER_CARD_MOTIF_BOX,
  playerCardMotifColors,
  playerCardMotifStrokes,
  type PlayerCardMotif,
} from '../data/player-card-motifs';
import './player-card.css';

/** 右下身分圖案（裝飾）：路徑與色票都來自 player-card-motifs，與 PNG 同一份；右下圓角裁切由 CSS clip-path 處理。 */
function PlayerCardMotifSvg({ motif, theme }: { motif: PlayerCardMotif; theme: PlayerCardTheme }): JSX.Element {
  const colors = playerCardMotifColors(motif, theme);
  return (
    <svg
      class="player-card-motif"
      data-motif={motif.key}
      data-motif-palette={motif.palette}
      viewBox={`0 0 ${PLAYER_CARD_MOTIF_BOX.width} ${PLAYER_CARD_MOTIF_BOX.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke-linecap="round" stroke-linejoin="round">
        {playerCardMotifStrokes(motif).map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill={s.fill ? colors[s.fill] : 'none'}
            stroke={s.stroke ? colors[s.stroke] : undefined}
            stroke-width={s.stroke ? s.width : undefined}
            stroke-dasharray={s.dash ? s.dash.join(' ') : undefined}
            opacity={s.petal ? colors.petalOpacity : colors.opacity}
          />
        ))}
      </g>
    </svg>
  );
}

/** 半圓轉速表幾何（viewBox 40×23，圓心 20,20，外弧半徑 17）：0 RPM 在左、上限在右。 */
function gaugePoint(rpm: number, r: number): string {
  const a = Math.PI * (1 - rpm / PLAYER_CARD_GAUGE_MAX_RPM);
  return `${(20 + r * Math.cos(a)).toFixed(2)} ${(20 - r * Math.sin(a)).toFixed(2)}`;
}
function gaugeArc(from: number, to: number): string {
  return `M${gaugePoint(from, 17)}A17 17 0 0 1 ${gaugePoint(to, 17)}`;
}
/** 每 75 RPM 一條細刻度（共 13 條，與 720 版疏密相同），每 225 RPM 主刻度（0／225／450／675／900 共 5 條）。模組層算一次，畫面不重算。 */
const GAUGE_TICKS = Array.from({ length: PLAYER_CARD_GAUGE_MAX_RPM / 75 + 1 }, (_, i) => {
  const rpm = i * 75;
  return {
    d: `M${gaugePoint(rpm, rpm % 225 === 0 ? 12.5 : 14.5)}L${gaugePoint(rpm, 17)}`,
    major: rpm % 225 === 0,
    red: rpm >= PLAYER_CARD_RPM_REDLINE,
  };
});

/** 轉速表（裝飾）：指針角度由 player-card-spin 直寫 transform，靜止指 0。 */
function RpmGauge({ needleRef }: { needleRef: { current: SVGGElement | null } }): JSX.Element {
  return (
    <svg class="player-card-rpm-gauge" viewBox="0 0 40 23" aria-hidden="true" focusable="false">
      <path class="player-card-rpm-gauge-arc" d={gaugeArc(0, PLAYER_CARD_GAUGE_MAX_RPM)} />
      <path class="player-card-rpm-gauge-red" d={gaugeArc(PLAYER_CARD_RPM_REDLINE, PLAYER_CARD_GAUGE_MAX_RPM)} />
      {GAUGE_TICKS.map((tick) => (
        <path
          key={tick.d}
          class={`player-card-rpm-gauge-tick${tick.major ? ' is-major' : ''}${tick.red ? ' is-red' : ''}`}
          d={tick.d}
        />
      ))}
      <g class="player-card-rpm-needle" ref={needleRef} transform={`rotate(${rpmToNeedleDeg(0)} 20 20)`}>
        <path d="M20 20L20 6" />
      </g>
      <circle class="player-card-rpm-gauge-hub" cx="20" cy="20" r="1.8" />
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.75-1.4'} />
    </svg>
  );
}

/** 斜光（與 PNG 同一組常數）：每層一個鋪滿卡面的元素，soft-light 層加 is-soft-light（CSS 設 mix-blend-mode）；
 * 轉動時由 player-card-spin 直寫 transform 讓光帶滑過（不重畫），靜止回到這裡的固定位置。 */
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
  topBar,
}: {
  model: PlayerCardModel;
  /** 頭像節點（沿用 LegacyAvatar，含第二身分皇冠）。 */
  avatar: ComponentChildren;
  /** 卡片上方、與鎖頭同一列置中顯示的內容（個人頁放身分標籤）；不進卡面、不進 PNG。 */
  topBar?: ComponentChildren;
}): JSX.Element {
  const t = useT();
  useTheme(); // 深淺色切換時重畫 logo 與斜光
  const theme = resolvePlayerCardTheme();
  const gaugeWidth = `${Math.round(model.gaugeRatio * 100)}%`;
  const [locked, setLocked] = useState(readPlayerCardLocked);
  const { flipRef, rpmRef, bestRef, needleRef, initialBest, handlers } = usePlayerCardSpin(locked);
  const toggleLock = (): void => {
    const next = !locked;
    setLocked(next);
    writePlayerCardLocked(next);
  };
  const logoUrl = playerCardLogoUrl(theme);

  // 外層留出鎖頭列；只有舞台吃撥動手勢（鎖頭在舞台外，點它不會翻）。正面仍是 .player-card（既有測試與 PNG 對照不變）。
  return (
    <div class="player-card-spin">
      {topBar != null && <div class="player-card-topbar">{topBar}</div>}
      {/* 轉速：數字由 player-card-spin 直寫 DOM（不重畫整卡）；裝飾性資訊，讀屏略過。 */}
      <div class="player-card-rpm" aria-hidden="true">
        <span class="player-card-rpm-row">
          <span class="player-card-rpm-now">
            <span class="player-card-rpm-num" ref={rpmRef}>0</span>/RPM
          </span>
          <RpmGauge needleRef={needleRef} />
        </span>
        <span class="player-card-rpm-best">
          {t('profile.playerCard.bestRpm')}
          <span class="player-card-rpm-best-num" ref={bestRef}>{String(initialBest)}</span>
        </span>
      </div>
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
            {model.motif && <PlayerCardMotifSvg motif={model.motif} theme={theme} />}
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
