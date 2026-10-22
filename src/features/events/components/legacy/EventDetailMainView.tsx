import type { JSX } from 'preact';
import { UserTag } from '@/ui/UserTag';
import { getEventParticipantStats } from '../../data/participant-stats';
import { eventStartMs } from '../../data/terminal';
import type { UserRole } from '@/ui/Avatar';
import { count, safeImageUrl, type DetailEvent } from '../../data/detail-model';
import { parseEventStartDate } from '../../data/event-lifecycle';
import { renderEventSocialLinksHtml } from '../../data/event-social-links';


export type LegacyDetailEvent = DetailEvent & {
  minAge?: number;
  genderRestrictionEnabled?: boolean;
  allowedGender?: string;
  contact?: string;
  creatorTeamName?: string;
  socialLinksEnabled?: boolean;
  socialLinks?: unknown;
  viewCount?: number;
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
  // 照 A _parseEventStartDate（B 移植版 parseEventStartDate）；小時不補零（9:52）也要能解析。
  const startDate = parseEventStartDate(event.date);
  if (!startDate) return '';
  const start = startDate.getTime();
  const diff = start - nowMs;
  if (diff <= 0) return '已結束';
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `剩餘 ${days}日${hours}時`;
  if (hours > 0) return `剩餘 ${hours}時${mins}分`;
  return `剩餘 ${mins}分`;
}

function formatRegOpenInfo(
  event: LegacyDetailEvent,
  nowMs: number,
): { regStr: string; suffix: string; isUpcoming: boolean } | null {
  if (!event.regOpenTime) return null;
  const regDate = new Date(event.regOpenTime);
  if (!Number.isFinite(regDate.getTime())) return null;
  const regStr = `${regDate.getFullYear()}/${String(regDate.getMonth() + 1).padStart(2, '0')}/${String(regDate.getDate()).padStart(2, '0')} ${String(regDate.getHours()).padStart(2, '0')}:${String(regDate.getMinutes()).padStart(2, '0')}`;
  if (event.status === 'upcoming') {
    const diff = regDate.getTime() - nowMs;
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
  const regOpen = formatRegOpenInfo(event, nowMs);
  const feeEnabled = event.feeEnabled ?? count(event.fee) > 0;
  const fee = feeEnabled ? count(event.fee) : 0;
  const maxCount = count(event.max);
  const stats = getEventParticipantStats(event, []);
  const reservedText = stats.reservedRemainingCount > 0
    ? ` 預留 ${stats.reservedRemainingCount}`
    : '';
  const waitlistText = waitlistCount > 0 ? ` 候補 ${waitlistCount}` : '';
  const isEnded = event.status === 'ended' || event.status === 'cancelled';
  const countdown = calcCountdown(event, nowMs);
  const minAge = count(event.minAge);
  const allowedGender = getAllowedGender(event);
  const heatPrediction = isEnded ? null : calcHeatPrediction(event, nowMs);

  const hostUid = (event.creatorUid ?? '').trim();
  const hostName = (event.creator || event.creatorName || hostUid).trim();
  const delegates = extractDelegates(event.delegates);
  const teamDisplayName = event.creatorTeamName || '俱樂部';

  return (
    <>
      <div class="detail-row detail-row-wide" data-detail-field="location">
        <span class="detail-label">地點</span>
        <a
          href={mapUrl}
          target="sporthub_map"
          rel="noopener"
          style="color:var(--primary);text-decoration:none"
        >
          {`${event.location ?? ''} 📍`}
        </a>
      </div>

      <div class="detail-row detail-row-wide" data-detail-field="date">
        <span class="detail-label">時間</span>
        {event.date ?? ''}
      </div>

      {regOpen && (
        <div class="detail-row detail-row-wide" data-detail-field="registration-open">
          <span class="detail-label">開放報名</span>
          {regOpen.isUpcoming ? (
            <span style="color:var(--info);font-weight:600">
              {`${regOpen.regStr}${regOpen.suffix}`}
            </span>
          ) : (
            `${regOpen.regStr}${regOpen.suffix}`
          )}
        </div>
      )}

      <div class="detail-grid">
        {feeEnabled && (
          <div class="detail-row" data-detail-field="fee">
            <span class="detail-label">費用</span>
            {fee > 0 ? `NT$${fee}` : '免費'}
          </div>
        )}
        <div class="detail-row" data-detail-field="capacity-count">
          <span class="detail-label">人數</span>
          {`已報 ${confirmedCount}/${maxCount}${reservedText}${waitlistText}`}
        </div>
        <div class="detail-row" data-detail-field="countdown">
          <span class="detail-label">倒數</span>
          <span
            style={`color:${isEnded ? 'var(--text-muted)' : 'var(--primary)'};font-weight:600`}
          >
            {countdown}
          </span>
        </div>
        {minAge > 0 && (
          <div class="detail-row" data-detail-field="age-limit">
            <span class="detail-label">年齡</span>
            {`${minAge} 歲以上`}
          </div>
        )}
        {allowedGender && (
          <div class="detail-row" data-detail-field="gender-limit">
            <span class="detail-label">性別</span>
            <span style="color:#dc2626;font-weight:700">
              {getGenderDetailText(allowedGender)}
            </span>
          </div>
        )}
        {heatPrediction && (
          <div class="detail-row" data-detail-field="heat">
            <span class="detail-label">熱度</span>
            <span style={`color:${HEAT_COLORS[heatPrediction]};font-weight:600;white-space:nowrap`}>
              {HEAT_LABELS[heatPrediction]}
            </span>
          </div>
        )}
        {teamSplitSlot}
      </div>

      <div class="detail-row detail-row-wide detail-host-row" data-detail-field="host">
        <span class="detail-label">主辦</span>
        <span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">
          <UserTag
            uid={hostUid}
            name={hostName || '未命名使用者'}
            role={roles[hostUid]}
            disabled={!hostUid}
            onOpenProfile={onOpenProfile}
          />
        </span>
        {/* 照 A contactEventOrganizer */}
        <button
          type="button"
          class="event-host-contact-pill"
          onClick={onContactHost}
        >
          聯繫主辦
        </button>
      </div>

      {delegates.length > 0 && (
        <div class="detail-row detail-row-wide" data-detail-field="delegates">
          <span class="detail-label">委託</span>
          <span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">
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
        </div>
      )}

      {event.socialLinksEnabled && (
        <div
          class="detail-row detail-row-wide detail-social-links-row"
          data-detail-field="social-links"
        >
          <span class="detail-label">社群</span>
          <span
            class="event-social-link-list"
            dangerouslySetInnerHTML={{ __html: renderEventSocialLinksHtml(event.socialLinks) }}
          />
        </div>
      )}

      {event.contact && (
        <div class="detail-row detail-row-wide" data-detail-field="contact">
          <span class="detail-label">聯繫</span>
          {event.contact}
        </div>
      )}

      {event.teamOnly && (
        <div class="detail-row detail-row-wide" data-detail-field="team-limit">
          <span class="detail-label">限定</span>
          <span style="color:#e11d48;font-weight:600">
            {event.creatorTeamId ? (
              <>
                {/* 照 A showTeamDetail */}
                <a
                  href="javascript:void(0)"
                  style="color:inherit;text-decoration:underline;text-underline-offset:2px"
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
        <div class="detail-row detail-row-wide" data-detail-field="private-visibility">
          <span class="detail-label">可見</span>
          <span style="color:#7c3aed;font-weight:600">
            🔒 私密活動 — 僅限連結分享
          </span>
        </div>
      )}

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


