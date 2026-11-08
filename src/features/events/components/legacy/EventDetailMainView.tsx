import type { JSX } from 'preact';
import { openHttpAnchor } from '@/core/open-external';
import { UserTag } from '@/ui/UserTag';
import { getEventParticipantStats } from '../../data/participant-stats';
import { eventStartMs } from '../../data/terminal';
import type { UserRole } from '@/ui/Avatar';
import { count, safeImageUrl, type DetailEvent } from '../../data/detail-model';
import { parseEventDate, parseEventStartMs } from '@/core/event-time';
import { renderEventSocialLinksHtml } from '../../data/event-social-links';
import { formatTaipei, parseTaipei, taipeiParts } from '@/core/taipei-time';
import { getEventEarlyBirdCost, isEventEarlyBirdWindow } from '../../data/signup-restrictions';
import './event-detail-c2.css';
import './signup-a11y.css'; // 報名卡「已報」讀屏文字用 .fcb-sr-only


export type LegacyDetailEvent = DetailEvent & {
  minAge?: number;
  genderRestrictionEnabled?: boolean;
  allowedGender?: string;
  contact?: string;
  creatorTeamName?: string;
  socialLinksEnabled?: boolean;
  socialLinks?: unknown;
  viewCount?: number;
  earlyBirdEnabled?: unknown;
  earlyBirdCost?: unknown;
};

interface DelegateEntry {
  uid: string;
  name: string;
}

const RIBBON_CONFIG: Record<string, string> = {
  friendly: '友誼',
  camp: '教學',
  play: 'PLAY',
  watch: '觀賽',
  course: '課程',
};

type HeatPredictionKey = 'hot' | 'warm' | 'normal' | 'cold';

const HEAT_COLORS: Record<HeatPredictionKey, string> = {
  hot: '#dc2626',
  warm: '#f59e0b',
  normal: '#3b82f6',
  cold: '#059669',
};

const HEAT_LABELS: Record<HeatPredictionKey, string> = {
  hot: '高人氣即將額滿',
  warm: '報名熱烈增加中',
  normal: '穩定開放報名中',
  cold: '潛力場次招募中',
};

/**
 * 照舊版 A `event-list.js#_calcHeatPrediction`（第 317～331 行）。
 */
export function calcHeatPrediction(
  event: LegacyDetailEvent,
  nowMs: number = Date.now(),
): HeatPredictionKey | null {
  const max = Number(event.max || 0);
  if (!max || max === 0) return null;
  const current = Number(event.current || 0);
  const fillRate = current / max;
  const startMs = eventStartMs(event);
  if (!startMs || startMs <= 0) {
    return fillRate >= 0.8 ? 'hot' : fillRate >= 0.5 ? 'warm' : 'normal';
  }
  const daysLeft = Math.max(0, (startMs - nowMs) / 86400000);
  if (fillRate >= 0.9) return 'hot';
  if (fillRate >= 0.7 && daysLeft > 3) return 'hot';
  if (fillRate >= 0.5) return 'warm';
  if (fillRate >= 0.3 && daysLeft > 7) return 'warm';
  if (fillRate < 0.15 && daysLeft < 3) return 'cold';
  return 'normal';
}

function getCoverRibbonMeta(event: LegacyDetailEvent): { typeKey: string; label: string } {
  const raw = event.type || 'friendly';
  const typeKey = RIBBON_CONFIG[raw] ? raw : 'friendly';
  return { typeKey, label: RIBBON_CONFIG[typeKey] ?? '友誼' };
}

function getAllowedGender(event: LegacyDetailEvent): string {
  if (!event.genderRestrictionEnabled) return '';
  return event.allowedGender === '男' || event.allowedGender === '女'
    ? event.allowedGender
    : '';
}

function getGenderDetailText(allowedGender: string): string {
  return allowedGender === '男' ? '限男生' : '限女生';
}

function extractDelegates(raw: unknown): DelegateEntry[] {
  if (!Array.isArray(raw)) return [];
  const list: DelegateEntry[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const uid = typeof obj.uid === 'string' ? obj.uid.trim() : '';
    if (!name && !uid) continue;
    list.push({ uid, name: name || uid });
  }
  return list;
}

function calcCountdown(event: LegacyDetailEvent, nowMs: number): string {
  // 照 A _calcCountdown。
  if (event.status === 'ended') return '已結束';
  if (event.status === 'cancelled') return '已取消';
  if (event.status === 'upcoming' && event.regOpenTime) return '即將開放';
  // 沿用斜線日期限制；小時不補零（9:52）仍可解析。
  if (typeof event.date !== 'string' || (event.date.split(' ')[0] ?? '').split('/').length < 3) return '';
  const start = parseEventStartMs(event.date);
  if (start === null) return '';
  const diff = start - nowMs;
  if (diff <= 0) return '已結束';
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  // C2 票根：倒數是距離活動開始（不是報名截止），前綴由「剩餘」改為「距開始」，數字算法不變。
  if (days > 0) return `距開始 ${days}日${hours}時`;
  if (hours > 0) return `距開始 ${hours}時${mins}分`;
  return `距開始 ${mins}分`;
}

function formatRegOpenInfo(
  event: LegacyDetailEvent,
  nowMs: number,
): { regStr: string; suffix: string; isUpcoming: boolean } | null {
  if (!event.regOpenTime) return null;
  // 解析與讀回必須同一套台北牆鐘。取代 new Date ＋ getFullYear／getHours，避免非 UTC+8 把開放報名顯示成另一天。
  const ms = parseTaipei(event.regOpenTime);
  if (ms === null) return null;
  const regStr = formatTaipei(ms, 'YYYY/MM/DD HH:mm');
  if (!regStr) return null;
  if (event.status === 'upcoming') {
    const diff = ms - nowMs;
    const totalMin = Math.max(0, Math.floor(diff / 60000));
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const countdownTxt = days > 0
      ? `${days}日${hours}時後開放`
      : hours > 0
        ? `${hours}時${totalMin % 60}分後開放`
        : `${totalMin}分後開放`;
    return { regStr, suffix: `（${countdownTxt}）`, isUpcoming: true };
  }
  return { regStr, suffix: '（已開放）', isUpcoming: false };
}



const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

interface TicketDate {
  month: number;
  day: string;
  weekday: string;
  time: string;
  duration: string;
}

/** C2 票根：月／日／星期與時間一律用台北牆鐘；結束時間早於開始（跨日）時不推算時長。 */
function getTicketDate(value: unknown): TicketDate | null {
  const parsed = parseEventDate(value);
  if (!parsed) return null;
  const start = taipeiParts(parsed.startMs);
  const end = parsed.explicitEndMs;
  const hasEnd = parsed.hasTime && end !== null && end > parsed.startMs;
  const time = parsed.hasTime
    ? formatTaipei(parsed.startMs, 'HH:mm') + (hasEnd ? `–${formatTaipei(end, 'HH:mm')}` : '')
    : '';
  let duration = '';
  if (hasEnd) {
    const totalMin = Math.round((end - parsed.startMs) / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    duration = h > 0 ? `${h} 小時${m > 0 ? ` ${m} 分` : ''}` : `${m} 分鐘`;
  }
  return {
    month: start.month,
    day: String(start.day).padStart(2, '0'),
    weekday: WEEKDAY_NAMES[start.weekday] ?? '',
    time,
    duration,
  };
}

type EvdIconName = 'pin' | 'nav' | 'flame' | 'cake' | 'gender' | 'shield' | 'lock' | 'msg' | 'door' | 'phone';

// 線條圖示（R-UI-002）；有 label 時給讀屏，沒有時當裝飾（外層按鈕自帶 aria-label）。
const EVD_ICON_PATHS: Record<EvdIconName, JSX.Element> = {
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  nav: <path d="M3 11l18-8-8 18-2-8z" />,
  flame: <path d="M12 21c4 0 7-2.7 7-6.5 0-3.6-3-5.5-4-9.5-2 1.5-3 3.5-3 5.5-1-1-2-2-2-3.5C7 9 5 11.5 5 14.5 5 18.3 8 21 12 21z" />,
  cake: <path d="M4 20h16v-7H4zM4 16h16M12 13V9M12 6.5V6" />,
  gender: <><circle cx="10" cy="14" r="5" /><path d="M14 10l6-6M15 4h5v5" /></>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  msg: <path d="M4 5h16v11H9l-5 4z" />,
  door: <path d="M5 21V4h11v17M3 21h18M13 12h.01" />,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
};

function EvdIcon({ name, label, size = 16 }: { name: EvdIconName; label?: string; size?: number }): JSX.Element {
  return (
    <svg
      class="evd-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
    >
      {EVD_ICON_PATHS[name]}
    </svg>
  );
}

export interface EventDetailCoverProps {
  event: LegacyDetailEvent;
  /** A 編輯 helper 的結果，不使用現場操作權。 */
  canEdit: boolean;
  onEdit: () => void;
}

export function EventDetailCover({
  event,
  canEdit,
  onEdit,
}: EventDetailCoverProps): JSX.Element {
  const coverImage = safeImageUrl(event.imageVariants?.cover || event.image);
  const ribbonMeta = getCoverRibbonMeta(event);
  // 照 A `_renderEventDetailEditButton`。
  const editButton = canEdit ? (
    <button
      type="button"
      class="detail-cover-edit-btn"
      data-event-id={event.id || event._docId || event.docId || ''}
      onClick={click => {
        click.stopPropagation();
        onEdit();
      }}
    >
      <svg class="detail-cover-edit-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.4-9.4z" />
      </svg>
      <span>活動編輯</span>
    </button>
  ) : null;

  return (
    <div
      class="td-img-placeholder"
      id="detail-img-placeholder"
      data-i18n="活動圖片 800 × 300"
      style={coverImage ? 'border:none' : undefined}
    >
      {coverImage ? (
        <div class="detail-cover-media">
          <img
            class="detail-cover-image"
            src={coverImage}
            alt={event.title ?? ''}
            width={1200}
            height={450}
            loading="lazy"
            decoding="async"
          />
          <span class={`detail-cover-ribbon detail-cover-ribbon-${ribbonMeta.typeKey}`}>
            {ribbonMeta.label}
          </span>
          {editButton}
        </div>
      ) : (
        <div class="detail-cover-media detail-cover-media-empty">
          <span class="detail-cover-placeholder-text">活動圖片 800 × 300</span>
          <span class={`detail-cover-ribbon detail-cover-ribbon-${ribbonMeta.typeKey}`}>
            {ribbonMeta.label}
          </span>
          {editButton}
        </div>
      )}
    </div>
  );
}

export interface EventDetailInfoSectionProps {
  event: LegacyDetailEvent;
  confirmedCount: number;
  waitlistCount: number;
  nowMs: number;
  roles: Record<string, UserRole | undefined>;
  onOpenProfile: (uid: string) => void;
  onContactHost: () => void;
  onOpenTeam: (teamId: string) => void;
  teamSplitSlot?: JSX.Element | null;
}

export function EventDetailInfoSection({
  event,
  confirmedCount,
  waitlistCount,
  nowMs,
  roles,
  onOpenProfile,
  onContactHost,
  onOpenTeam,
  teamSplitSlot,
}: EventDetailInfoSectionProps): JSX.Element {
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location ?? '')}`;
  const openMap = (click: JSX.TargetedMouseEvent<HTMLAnchorElement>): void => {
    openHttpAnchor(click, mapUrl);
  };
  const ticket = getTicketDate(event.date);
  const regOpen = formatRegOpenInfo(event, nowMs);
  const feeEnabled = event.feeEnabled ?? count(event.fee) > 0;
  const fee = feeEnabled ? count(event.fee) : 0;
  const maxCount = count(event.max);
  const stats = getEventParticipantStats(event, []);
  const reservedCount = stats.reservedRemainingCount;
  const isEnded = event.status === 'ended' || event.status === 'cancelled';
  const countdown = calcCountdown(event, nowMs);
  const minAge = count(event.minAge);
  const allowedGender = getAllowedGender(event);
  const heatPrediction = isEnded ? null : calcHeatPrediction(event, nowMs);
  const earlyBirdCost = isEventEarlyBirdWindow(event, new Date(nowMs)) ? getEventEarlyBirdCost(event) : 0;

  // C2 報名卡：剩餘＝上限扣正取與團隊保留（同 A 的 occupied 算法）；沒有的項目不出現。
  const remainingCount = maxCount > 0 ? Math.max(0, maxCount - confirmedCount - reservedCount) : 0;
  const capacityMeta = [
    maxCount > 0 ? `剩 ${remainingCount}` : '',
    reservedCount > 0 ? `團隊保留 ${reservedCount}` : '',
    waitlistCount > 0 ? `候補 ${waitlistCount}` : '',
  ].filter(Boolean).join(' · ');
  const confirmedPct = maxCount > 0 ? Math.min(100, (confirmedCount / maxCount) * 100) : 0;
  const reservedPct = maxCount > 0 ? Math.min(100 - confirmedPct, (reservedCount / maxCount) * 100) : 0;
  const hasRegChips = feeEnabled || !!heatPrediction || earlyBirdCost > 0 || !!regOpen;

  const hostUid = (event.creatorUid ?? '').trim();
  const hostName = (event.creator || event.creatorName || hostUid).trim();
  const delegates = extractDelegates(event.delegates);
  const teamDisplayName = event.creatorTeamName || '俱樂部';
  const hasConditions = minAge > 0 || !!allowedGender || !!event.teamOnly || !!event.privateEvent;

  return (
    <>
      <div class="evd-ticket">
        {ticket && (
          <div class="evd-ticket-stub">
            <span class="evd-ticket-mo">{`${ticket.month} 月`}</span>
            <span class="evd-ticket-day">{ticket.day}</span>
            <span class="evd-ticket-wd">{`週${ticket.weekday}`}</span>
          </div>
        )}
        <div class="evd-ticket-main">
          <div class="evd-ticket-time" data-detail-field="date">
            {ticket ? ticket.time : (event.date ?? '')}
          </div>
          <div class="evd-ticket-sub">
            {ticket?.duration && <span>{ticket.duration}</span>}
            {ticket?.duration && countdown && <span aria-hidden="true">{' · '}</span>}
            <span
              data-detail-field="countdown"
              style={`color:${isEnded ? 'var(--text-muted)' : 'var(--primary)'};font-weight:600`}
            >
              {countdown}
            </span>
          </div>
          <div class="evd-ticket-loc" data-detail-field="location">
            <EvdIcon name="pin" label="地點" />
            <a class="evd-ticket-loc-link" href={mapUrl} rel="noopener" onClick={openMap}>
              {event.location ?? ''}
            </a>
            <a class="evd-icon-btn evd-icon-btn-sm" href={mapUrl} rel="noopener" aria-label="導航" title="導航" onClick={openMap}>
              <EvdIcon name="nav" />
            </a>
          </div>
        </div>
      </div>

      <section class="evd-card">
        <h3 class="evd-card-title">報名</h3>
        <div class="evd-reg-head" data-detail-field="capacity-count">
          <span class="evd-reg-count">
            <span class="fcb-sr-only">已報 </span>
            {`${confirmedCount}/${maxCount}`}
          </span>
          {capacityMeta && <span class="evd-reg-meta">{capacityMeta}</span>}
        </div>
        {maxCount > 0 && (
          <div class="evd-progress" aria-hidden="true">
            <i class="evd-progress-confirmed" style={`width:${confirmedPct}%`} />
            {reservedPct > 0 && <i class="evd-progress-reserved" style={`width:${reservedPct}%`} />}
          </div>
        )}
        {hasRegChips && (
          <div class="evd-chips">
            {feeEnabled && (
              <span class="evd-chip evd-chip-fee" data-detail-field="fee">
                {fee > 0 ? `NT$${fee}` : '免費'}
              </span>
            )}
            {heatPrediction && (
              <span class="evd-chip evd-chip-tint" data-detail-field="heat" style={`color:${HEAT_COLORS[heatPrediction]}`}>
                <EvdIcon name="flame" label="熱度" size={14} />
                <span style={`color:${HEAT_COLORS[heatPrediction]};font-weight:600;white-space:nowrap`}>
                  {HEAT_LABELS[heatPrediction]}
                </span>
              </span>
            )}
            {earlyBirdCost > 0 && (
              <span class="evd-chip evd-chip-tint evd-chip-early" data-detail-field="early-bird">
                {`早鳥 ${earlyBirdCost} 積分`}
              </span>
            )}
            {regOpen && (
              <span class="evd-chip" data-detail-field="registration-open">
                <EvdIcon name="door" label="開放報名" size={14} />
                {regOpen.isUpcoming ? (
                  <span style="color:var(--info);font-weight:600">
                    {`${regOpen.regStr}${regOpen.suffix}`}
                  </span>
                ) : (
                  `${regOpen.regStr}${regOpen.suffix}`
                )}
              </span>
            )}
          </div>
        )}
      </section>

      {teamSplitSlot && <div class="detail-grid">{teamSplitSlot}</div>}

      {hasConditions && (
        <section class="evd-card" data-evd-card="conditions">
          <h3 class="evd-card-title">參加條件</h3>
          {minAge > 0 && (
            <div class="evd-line" data-detail-field="age-limit">
              <EvdIcon name="cake" label="年齡" />
              <span>{`${minAge} 歲以上`}</span>
            </div>
          )}
          {allowedGender && (
            <div class="evd-line" data-detail-field="gender-limit">
              <EvdIcon name="gender" label="性別" />
              <span>{getGenderDetailText(allowedGender)}</span>
            </div>
          )}
          {event.teamOnly && (
            <div class="evd-line" data-detail-field="team-limit">
              <EvdIcon name="shield" label="限定俱樂部" />
              <span>
                {event.creatorTeamId ? (
                  <>
                    {/* 照 A showTeamDetail */}
                    <a
                      href="javascript:void(0)"
                      class="evd-team-link"
                      onClick={(ev) => {
                        ev.preventDefault();
                        if (event.creatorTeamId) onOpenTeam(event.creatorTeamId);
                      }}
                    >
                      {teamDisplayName}
                    </a>
                    {' 專屬活動'}
                  </>
                ) : (
                  `${teamDisplayName} 專屬活動`
                )}
              </span>
            </div>
          )}
          {event.privateEvent && (
            <div class="evd-line" data-detail-field="private-visibility">
              <EvdIcon name="lock" label="可見範圍" />
              <span>私密活動，僅限連結</span>
            </div>
          )}
        </section>
      )}

      <section class="evd-card">
        <h3 class="evd-card-title">主辦團隊</h3>
        <div class="evd-host-row" data-detail-field="host">
          <span class="participant-list evd-tag-list">
            <UserTag
              uid={hostUid}
              name={hostName || '未命名使用者'}
              role={roles[hostUid]}
              disabled={!hostUid}
              onOpenProfile={onOpenProfile}
            />
          </span>
          <span class="evd-muted">主辦</span>
          {/* 照 A contactEventOrganizer */}
          <button
            type="button"
            class="evd-icon-btn evd-host-contact"
            aria-label="聯繫主辦"
            title="聯繫主辦"
            onClick={onContactHost}
          >
            <EvdIcon name="msg" />
          </button>
        </div>

        {delegates.length > 0 && (
          <div class="evd-delegate-row" data-detail-field="delegates">
            <span class="participant-list evd-tag-list">
              {delegates.map((d, idx) => (
                <UserTag
                  key={`${d.uid || d.name}-${idx}`}
                  uid={d.uid}
                  name={d.name}
                  role={d.uid ? roles[d.uid] : undefined}
                  disabled={!d.uid}
                  onOpenProfile={onOpenProfile}
                />
              ))}
            </span>
            <span class="evd-muted">委託人</span>
          </div>
        )}

        {event.contact && (
          <div class="evd-line" data-detail-field="contact">
            <EvdIcon name="phone" label="聯繫方式" />
            <span class="evd-line-text">{event.contact}</span>
          </div>
        )}

        {event.socialLinksEnabled && (
          <div class="evd-social-row" data-detail-field="social-links">
            <span
              class="event-social-link-list"
              dangerouslySetInnerHTML={{ __html: renderEventSocialLinksHtml(event.socialLinks) }}
              onClick={(event) => {
                const raw = event.target;
                if (!(raw instanceof Element)) return;
                const anchor = raw.closest('a');
                if (!anchor || !event.currentTarget.contains(anchor)) return;
                openHttpAnchor(event, anchor.getAttribute('href') ?? '');
              }}
            />
          </div>
        )}
      </section>

      {/* A showEventDetail：有注意事項才顯示整個區塊 */}
      {event.notes && (
        <div class="detail-section" data-detail-field="notes">
          <div class="detail-section-title">注意事項</div>
          <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">
            {event.notes}
          </p>
        </div>
      )}
    </>
  );
}


