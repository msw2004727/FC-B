import type { JSX } from 'preact';
import { UserTag } from '@/ui/UserTag';
import { getEventParticipantStats } from '../../data/participant-stats';
import { eventStartMs } from '../../data/terminal';
import type { UserRole } from '@/ui/Avatar';
import { count, eventDateRange, safeImageUrl, type DetailEvent } from '../../data/detail-model';
import type { SignupButtonState } from '../../data/signup-state';
import type { SignupCompanion } from '../../data/companions';

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
  if (event.status === 'cancelled') return '已取消';
  if (event.status === 'ended') return '已結束';
  const start = eventStartMs(event);
  if (!start || start <= 0) return '進行中';
  const diff = start - nowMs;
  if (diff <= 0) {
    const range = eventDateRange(event.date);
    if (range?.end) {
      const endMs = Date.parse(range.end);
      if (Number.isFinite(endMs) && nowMs >= endMs) return '已結束';
    }
    return '進行中';
  }
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}日${hours}時`;
  if (hours > 0) return `${hours}時${mins}分`;
  return `${mins}分`;
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

function renderGlowWrap(
  btn: JSX.Element,
  glowC: string,
  glowCLight: string,
  hint: string,
  loading: boolean,
): JSX.Element {
  return (
    <div
      class={`signup-glow-wrap${loading ? ' loading' : ''}`}
      style={`--glow-c:${glowC};--glow-c-light:${glowCLight}`}
    >
      <div class="signup-glow-border" />
      <div class="signup-glow-shadow" />
      <div class="signup-flipper">{btn}</div>
      <div class="signup-loading-hint">
        <div class="mini-spinner" />
        <span class="mini-text">{hint}</span>
      </div>
    </div>
  );
}

export interface EventDetailCoverProps {
  event: LegacyDetailEvent;
  canEdit: boolean;
  onUnavailable: (e?: MouseEvent) => void;
}

export function EventDetailCover({
  event,
  canEdit,
  onUnavailable,
}: EventDetailCoverProps): JSX.Element {
  const coverImage = safeImageUrl(event.imageVariants?.cover || event.image);
  const ribbonMeta = getCoverRibbonMeta(event);

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
          {/* 下一批補：詳情頁編輯活動入口 */}
          {canEdit && (
            <button
              type="button"
              class="detail-cover-edit-btn"
              onClick={onUnavailable}
            >
              編輯
            </button>
          )}
        </div>
      ) : (
        <div class="detail-cover-media detail-cover-media-empty">
          <span class="detail-cover-placeholder-text">活動圖片 800 × 300</span>
          <span class={`detail-cover-ribbon detail-cover-ribbon-${ribbonMeta.typeKey}`}>
            {ribbonMeta.label}
          </span>
          {/* 下一批補：詳情頁編輯活動入口 */}
          {canEdit && (
            <button
              type="button"
              class="detail-cover-edit-btn"
              onClick={onUnavailable}
            >
              編輯
            </button>
          )}
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
  onUnavailable: (e?: MouseEvent) => void;
}

export function EventDetailInfoSection({
  event,
  confirmedCount,
  waitlistCount,
  nowMs,
  roles,
  onOpenProfile,
  onUnavailable,
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

  const hostUid = (event.creatorUid ?? '').trim();
  const hostName = (event.creator || event.creatorName || hostUid).trim();
  const delegates = extractDelegates(event.delegates);
  const teamDisplayName = event.creatorTeamName || '俱樂部';

  return (
    <>
      <div class="detail-row detail-row-wide" data-detail-field="location">
        <span class="detail-label">地點</span>
        {event.location ? (
          <a
            href={mapUrl}
            target="sporthub_map"
            rel="noopener"
            style="color:var(--primary);text-decoration:none"
          >
            {`${event.location} 📍`}
          </a>
        ) : (
          <span>地点未定</span>
        )}
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
        {/* 下一批補：聯繫主辦私訊功能 */}
        <button
          type="button"
          class="event-host-contact-pill"
          onClick={onUnavailable}
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
                {/* 下一批補：俱樂部詳情頁導覽 */}
                <a
                  href="javascript:void(0)"
                  style="color:inherit;text-decoration:underline;text-underline-offset:2px"
                  onClick={(ev) => {
                    ev.preventDefault();
                    onUnavailable();
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

export interface EventDetailPrimaryButtonProps {
  event: LegacyDetailEvent;
  isGuest: boolean;
  state: SignupButtonState;
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}

export function EventDetailPrimaryButton({
  event,
  isGuest,
  state,
  label,
  disabled,
  busy,
  onClick,
}: EventDetailPrimaryButtonProps): JSX.Element {
  const isUpcoming = event.status === 'upcoming';
  const isEnded = state.kind === 'ended';
  const isMainFull = state.kind === 'waitlist';

  // 訪客按鈕照 A `_buildGuestEventSignupButton`
  if (isGuest) {
    if (event.teamOnly) {
      return (
        <button
          type="button"
          style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed;opacity:.7"
          disabled
        >
          球隊限定
        </button>
      );
    }
    if (isUpcoming) {
      return (
        <button
          type="button"
          style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed"
          disabled
        >
          報名尚未開放
        </button>
      );
    }
    if (isEnded) {
      return (
        <button
          type="button"
          style="background:#333;color:#999;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed"
          disabled
        >
          報名已結束
        </button>
      );
    }
    if (isMainFull) {
      return (
        <button
          type="button"
          style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer"
          disabled={disabled}
          onClick={onClick}
        >
          報名候補
        </button>
      );
    }
    return (
      <button
        type="button"
        class="primary-btn"
        disabled={disabled}
        onClick={onClick}
      >
        立即報名
      </button>
    );
  }

  // 登入者 8 種狀態照 A `_refreshSignupButton`
  const makeStyledBtn = (bg: string, btnDisabled: boolean): JSX.Element => (
    <button
      type="button"
      style={`background:${bg};color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:${btnDisabled ? 'not-allowed' : 'pointer'}${btnDisabled ? ';opacity:.7' : ''}`}
      disabled={btnDisabled}
      onClick={btnDisabled ? undefined : onClick}
    >
      {label}
    </button>
  );

  if (state.kind === 'ended') {
    return makeStyledBtn('#333', true);
  }
  if (state.kind === 'cancelWaitlist') {
    return renderGlowWrap(
      makeStyledBtn('#d97706', disabled),
      '#d97706',
      '#f59e0b',
      '正在取消候補',
      busy,
    );
  }
  if (state.kind === 'cancel') {
    return renderGlowWrap(
      makeStyledBtn('#dc2626', disabled),
      '#dc2626',
      '#f87171',
      '正在取消報名',
      busy,
    );
  }
  if (state.kind === 'notOpen') {
    return makeStyledBtn('#64748b', true);
  }
  if (state.kind === 'teamOnly') {
    return makeStyledBtn('#64748b', true);
  }
  if (state.kind === 'restricted') {
    return (
      <button
        type="button"
        style={`background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:.95`}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
      >
        {label}
      </button>
    );
  }
  if (state.kind === 'waitlist') {
    return renderGlowWrap(
      makeStyledBtn('#7c3aed', disabled),
      '#7c3aed',
      '#a78bfa',
      '報名候補中',
      busy,
    );
  }
  return renderGlowWrap(
    <button
      type="button"
      class="primary-btn"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>,
    'var(--accent)',
    'var(--accent-hover)',
    '報名中',
    busy,
  );
}

export interface CompanionSelectModalProps {
  open: boolean;
  mode: 'signup' | 'cancel' | null;
  eventTitle: string;
  viewerName: string;
  selfRegistered: boolean;
  companions: readonly SignupCompanion[];
  signedCompanions: ReadonlySet<string | undefined>;
  ownedItems: ReadonlyArray<{ key: string; label: string }>;
  selected: readonly string[];
  busy: boolean;
  fee: number;
  remaining: number | null;
  waitlistedEstimate: number;
  t: (key: string, params?: Record<string, string | number>) => string;
  onToggle: (key: string, checked: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function CompanionSelectModal({
  open,
  mode,
  eventTitle,
  viewerName,
  selfRegistered,
  companions,
  signedCompanions,
  ownedItems,
  selected,
  busy,
  fee,
  remaining,
  waitlistedEstimate,
  t,
  onToggle,
  onClose,
  onConfirm,
}: CompanionSelectModalProps): JSX.Element | null {
  if (!open || !mode) return null;
  const selectedCount = selected.length;
  const title = t(
    mode === 'cancel'
      ? 'events.detailPage.cancelTitle'
      : 'events.detailPage.chooseParticipants',
  );

  return (
    <div
      class="host-list-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        class="host-list-modal companion-select-modal open"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="host-list-header">
          <h3>{title}</h3>
          <button
            type="button"
            class="modal-close"
            aria-label="關閉"
            disabled={busy}
            onClick={() => { if (!busy) onClose(); }}
          >
            ✕
          </button>
        </div>
        <div class="host-list-body">
          <div style="font-weight:700;font-size:.88rem;margin-bottom:.5rem">
            {eventTitle}
          </div>
          {mode === 'cancel' ? (
            <div class="companion-select-list">
              <p style="font-size:.8rem;color:var(--text-secondary);margin:0 0 .4rem">
                {t('events.detailPage.cancelHint')}
              </p>
              {ownedItems.map((item) => {
                const isChecked = selected.includes(item.key);
                const isDisabled = busy || !item.key;
                return (
                  <label
                    key={item.key}
                    class={`companion-toggle-row${isChecked ? ' is-selected' : ''}${isDisabled ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={(e) => onToggle(item.key, e.currentTarget.checked)}
                    />
                    <span class="companion-toggle-main">
                      <span class="companion-toggle-name">{item.label}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div class="companion-select-list">
              <label
                class={`companion-toggle-row${(selfRegistered || selected.includes('self')) ? ' is-selected' : ''}${(busy || selfRegistered) ? ' is-disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selfRegistered || selected.includes('self')}
                  disabled={busy || selfRegistered}
                  onChange={(e) => onToggle('self', e.currentTarget.checked)}
                />
                <span class="companion-toggle-main">
                  <span class="companion-toggle-name">
                    {`${viewerName} ${t('events.detailPage.self')}`}
                  </span>
                </span>
              </label>
              {companions.map((item) => {
                const registered = signedCompanions.has(item.id);
                const key = `companion:${item.id}`;
                const isChecked = registered || selected.includes(key);
                const isDisabled = busy || registered;
                return (
                  <label
                    key={item.id}
                    class={`companion-toggle-row${isChecked ? ' is-selected' : ''}${isDisabled ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={(e) => onToggle(key, e.currentTarget.checked)}
                    />
                    <span class="companion-toggle-main">
                      <span class="companion-toggle-name">
                        {`${item.name}${registered ? ` ${t('events.detailPage.registered')}` : ''}`}
                      </span>
                    </span>
                  </label>
                );
              })}
              {companions.length === 0 && (
                <div style="font-size:.8rem;color:var(--text-muted)">
                  {t('events.detailPage.noCompanions')}
                </div>
              )}
              <div aria-live="polite" style="font-size:.78rem;color:var(--text-secondary);margin-top:.35rem">
                <div>{t('events.detailPage.selected', { count: selectedCount })}</div>
                <div>{t('events.detailPage.totalFee', { fee: fee * selectedCount })}</div>
                {remaining !== null && (
                  <div>{t('events.detailPage.remaining', { count: remaining })}</div>
                )}
                {waitlistedEstimate > 0 && (
                  <div>{t('events.detailPage.waitlistEstimate', { count: waitlistedEstimate })}</div>
                )}
              </div>
            </div>
          )}
          <div style="display:flex;justify-content:flex-end;margin-top:.85rem">
            <button
              type="button"
              class="primary-btn"
              disabled={busy || selected.length === 0}
              onClick={onConfirm}
            >
              {t(
                mode === 'cancel'
                  ? 'events.detailPage.confirmCancel'
                  : 'events.detailPage.confirmSignup',
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
