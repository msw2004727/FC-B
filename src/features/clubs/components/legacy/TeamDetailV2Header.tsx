import type { JSX } from 'preact';
import { SHOW_EXP } from '@/core/exp-display';
import { useT } from '@/i18n/i18n';
import { SPORTS } from '@/features/events/data/sports';
import { ActionRingButton, useActionRingControl, type ActionRingControl } from '@/ui/action-ring';
import type { ClubViewer, TeamDoc, TeamPrimaryAction } from '../../data/types';
import { canShowInviteQr } from '../../club-policy';
import { isUserCapabilityTeam } from '../../data/team-source';
import {
  getTeamCoverImageUrl,
  getTeamRank,
  isTeamTeachingTagged,
} from '../../data/team-list-model';

export type V2TabKey = 'overview' | 'courses' | 'events' | 'members' | 'record' | 'feed';

export interface V2TabDef {
  key: V2TabKey;
  label: string;
}

export function sanitizeHttpImageUrl(rawUrl: unknown): string {
  const trimmed = String(rawUrl ?? '').trim();
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

export function getSportLabel(team: TeamDoc | null | undefined): string {
  const key = String(team?.sportTag ?? '').trim();
  if (!key) return '';
  return SPORTS.find((s) => s.sportTag === key)?.label ?? key;
}

export function getRecruitText(team: TeamDoc | null | undefined, courseCount = 0): string {
  // C1（R-UI-026）：一般俱樂部不放招募說明句。
  if (!isTeamTeachingTagged(team)) return '';
  const accepting = team?.eduSettings?.acceptingStudents !== false;
  if (!accepting) return '目前暫停招收新學員';
  return courseCount > 0 ? `正在招收新學員 · ${courseCount} 個課程接受報名` : '正在招收新學員';
}

/**
 * A `_getTeamDetailAvatarUrl`：先讀 avatarUrl／logoUrl／logo／avatar，
 * 沒有就退回封面圖（`_getTeamCoverImageUrl(t,'cover')`，B 的 `getTeamCoverImageUrl` 已含 image 退回）。
 */
export function getTeamDetailAvatarUrl(team: TeamDoc | null | undefined): string {
  if (!team) return '';
  const record = team as Record<string, unknown>;
  for (const key of ['avatarUrl', 'logoUrl', 'logo', 'avatar']) {
    const value = record[key];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return sanitizeHttpImageUrl(text);
  }
  return sanitizeHttpImageUrl(getTeamCoverImageUrl(team, 'cover'));
}

export function canInviteToTeam(
  team: TeamDoc | null | undefined,
  viewer: ClubViewer | null | undefined,
): boolean {
  return canShowInviteQr(viewer, team);
}

function SvgIcon({ name }: { name: 'back' | 'more' | 'camera' | 'join' | 'check' | 'link' | 'contact' | 'qr' | 'leave' }): JSX.Element {
  switch (name) {
    case 'back':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      );
    case 'more':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      );
    case 'camera':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      );
    case 'join':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M20 8v6" />
          <path d="M23 11h-6" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'link':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
      );
    case 'contact':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        </svg>
      );
    case 'qr':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3h7v7H3z" />
          <path d="M14 3h7v7h-7z" />
          <path d="M3 14h7v7H3z" />
          <path d="M14 14h3v3h-3z" />
          <path d="M18 18h3v3h-3z" />
        </svg>
      );
    case 'leave':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          <path d="M17 16l4-4-4-4" />
          <path d="M21 12H9" />
        </svg>
      );
  }
}

export interface TeamDetailV2HeaderProps {
  team: TeamDoc;
  viewer: ClubViewer;
  canEdit: boolean;
  primaryAction: TeamPrimaryAction;
  busy: boolean;
  memberCount: number;
  courseCount: number;
  eventCount: number;
  totalGames: number;
  winRate: number;
  tabs: readonly V2TabDef[];
  activeTab: V2TabKey;
  onBack: () => void;
  /** C1：只有可編輯者才有「⋯」（開設定）；未提供時不顯示。 */
  onMore?: () => void;
  onContact: () => void;
  onInvite: () => void;
  /** C1：所有人都能複製俱樂部連結（取代未開放的分享鈕）。 */
  onCopyLink: () => void;
  onEditAvatar: () => void;
  onEditCover: () => void;
  imageBusyKind: 'avatar' | 'cover' | null;
  onJoin: () => void;
  /** 「加入俱樂部」的進度環；由頁面在送出申請時 start、依結果 succeed／fail。 */
  joinRing?: ActionRingControl;
  onJoined: () => void;
  onJoinPending: () => void;
  onLeave: () => void;
  onSelectTab: (tab: V2TabKey) => void;
}

export function TeamDetailV2Header({
  team,
  viewer,
  canEdit,
  primaryAction,
  busy,
  memberCount,
  courseCount,
  eventCount,
  totalGames,
  winRate,
  tabs,
  activeTab,
  onBack,
  onMore,
  onContact,
  onInvite,
  onCopyLink,
  onEditAvatar,
  onEditCover,
  imageBusyKind,
  onJoin,
  joinRing,
  onJoined,
  onJoinPending,
  onLeave,
  onSelectTab,
}: TeamDetailV2HeaderProps): JSX.Element {
  const t = useT();
  const idleJoinRing = useActionRingControl();
  const ring = joinRing ?? idleJoinRing;
  const sportLabel = getSportLabel(team);
  const subtitle = team.nameEn || sportLabel || team.region || '';
  const logoUrl = getTeamDetailAvatarUrl(team);
  const coverUrl = sanitizeHttpImageUrl(getTeamCoverImageUrl(team, 'cover'));
  const detailRank = getTeamRank(Number(team.teamExp || 0));
  const exp = Number(team.teamExp || 0);
  const initial = String(team.name || 'T').trim().charAt(0) || 'T';
  const recruitText = getRecruitText(team, courseCount);

  const chips = [
    sportLabel,
    team.region || (typeof team['nationality'] === 'string' ? team['nationality'] : '') || '',
    team['founded'] ? `${String(team['founded'])} 創立` : '',
    isTeamTeachingTagged(team) ? '教學俱樂部' : '',
  ].filter(Boolean);

  const isMember = primaryAction === 'leave';
  const canInvite = canInviteToTeam(team, viewer);

  // C1：數字列只留成員、活動、勝率，點了切到對應頁籤（頁籤沒開就不能點）。
  // 勝率只在戰績頁籤存在（有戰績資料）時顯示；T-090 自建俱樂部照舊不顯示勝率。
  const tabKeys = new Set(tabs.map((item) => item.key));
  const showWinRate = tabKeys.has('record') && !isUserCapabilityTeam(team);
  const allStats: ReadonlyArray<[string, string | number, string, V2TabKey]> = [
    ['成員', memberCount, '', 'members'],
    ['活動', eventCount, '', 'events'],
    ['勝率', `${winRate}%`, `${totalGames} 場`, 'record'],
  ];
  const stats = allStats.filter(([, , , tab]) => tab !== 'record' || showWinRate);

  return (
    <>
      <div class="td-v2-topbar">
        <button
          class="td-v2-icon-btn"
          type="button"
          data-td-v2-action="back"
          aria-label="返回"
          onClick={onBack}
        >
          <SvgIcon name="back" />
        </button>
        <div class="td-v2-title-wrap">
          <div class="td-v2-title">{team.name || '俱樂部名稱'}</div>
          {subtitle ? <div class="td-v2-subtitle">{subtitle}</div> : null}
        </div>
        {onMore ? (
          <button
            class="td-v2-icon-btn"
            type="button"
            data-td-v2-action="more"
            aria-label="更多操作"
            onClick={onMore}
          >
            <SvgIcon name="more" />
          </button>
        ) : (
          <span class="td-v2-icon-spacer" aria-hidden="true" />
        )}
      </div>

      <section class="td-v2-hero">
        {coverUrl && (
          <img
            class="td-v2-hero-cover"
            src={coverUrl}
            alt=""
            loading="eager"
            decoding="async"
          />
        )}
        <div class="td-v2-hero-shade" />
        {canEdit && (
          <button
            class="td-v2-cover-edit"
            type="button"
            data-td-v2-action="edit-cover"
            aria-label="更換俱樂部封面"
            title="更換俱樂部封面"
            onClick={onEditCover}
            disabled={imageBusyKind !== null}
            aria-busy={imageBusyKind === 'cover' ? 'true' : undefined}
          >
            <SvgIcon name="camera" />
          </button>
        )}
        <div class="td-v2-hero-inner">
          <div class="td-v2-hero-logo-wrap">
            {logoUrl ? (
              <div class="td-v2-hero-logo has-img">
                <img src={logoUrl} alt={team.name || ''} />
              </div>
            ) : (
              <div class="td-v2-hero-logo">
                <span>{initial}</span>
              </div>
            )}
            {canEdit && (
              <button
                class="td-v2-avatar-edit"
                type="button"
                data-td-v2-action="edit-avatar"
                aria-label="更換俱樂部頭像"
                title="更換俱樂部頭像"
                onClick={onEditAvatar}
                disabled={imageBusyKind !== null}
                aria-busy={imageBusyKind === 'avatar' ? 'true' : undefined}
              >
                <SvgIcon name="camera" />
              </button>
            )}
          </div>
          <div class="td-v2-hero-text">
            <div class="td-v2-hero-meta">
              {chips.map((text, idx) => (
                <span key={`${text}-${idx}`} class="td-v2-hero-chip">
                  {text}
                </span>
              ))}
            </div>
          </div>
        </div>
        {/* C1：EXP 徽章跟著全站 SHOW_EXP；一般俱樂部沒有招募句時整列不出。 */}
        {recruitText || SHOW_EXP ? (
          <div class="td-v2-hero-status">
            {recruitText ? (
              <>
                <span class="td-v2-pulse" />
                <span class="td-v2-hero-status-text">{recruitText}</span>
              </>
            ) : null}
            {SHOW_EXP ? (
              <span
                class="td-v2-hero-rank"
                style={{ '--td-v2-rank-color': detailRank.color || '#94a3b8' }}
              >
                <span>{exp.toLocaleString()}</span>
                <strong>{detailRank.rank || 'E'}</strong>
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <div class={`td-v2-cta-bar${isMember ? ' has-leave' : ''}`}>
        {primaryAction === 'pending' ? (
          <ActionRingButton
            control={ring}
            busyLabel="送出申請中..."
            class="td-v2-cta-primary pending"
            type="button"
            data-td-v2-action="join-pending"
            disabled={busy}
            onClick={onJoinPending}
          >
            <SvgIcon name="check" />
            <span>審核中</span>
          </ActionRingButton>
        ) : isMember ? (
          <ActionRingButton
            control={ring}
            busyLabel="送出申請中..."
            class="td-v2-cta-primary joined"
            type="button"
            data-td-v2-action="joined"
            disabled={busy}
            onClick={onJoined}
          >
            <SvgIcon name="check" />
            <span>已加入</span>
          </ActionRingButton>
        ) : (
          <ActionRingButton
            control={ring}
            busyLabel="送出申請中..."
            class="td-v2-cta-primary"
            type="button"
            data-td-v2-action="join"
            disabled={busy}
            onClick={onJoin}
          >
            <SvgIcon name="join" />
            <span>加入俱樂部</span>
          </ActionRingButton>
        )}
        {/* C1：LINE 分享留 C2 與邀請合併；先讓所有人都能複製俱樂部連結。 */}
        <button
          class="td-v2-cta-icon"
          type="button"
          data-td-v2-action="copy-link"
          aria-label={t('clubs.copyLink.label')}
          title={t('clubs.copyLink.label')}
          onClick={onCopyLink}
        >
          <SvgIcon name="link" />
        </button>
        <button
          class="td-v2-cta-icon"
          type="button"
          data-td-v2-action="contact"
          aria-label="聯繫負責人"
          onClick={onContact}
        >
          <SvgIcon name="contact" />
        </button>
        <button
          class="td-v2-cta-icon"
          type="button"
          data-td-v2-action="invite"
          disabled={!canInvite}
          aria-disabled={!canInvite ? 'true' : undefined}
          aria-label="邀請 QR"
          onClick={onInvite}
        >
          <SvgIcon name="qr" />
        </button>
        {isMember && (
          <button
            class="td-v2-cta-icon danger"
            type="button"
            data-td-v2-action="leave"
            aria-label="退出俱樂部"
            title="退出俱樂部"
            disabled={busy}
            onClick={onLeave}
          >
            <SvgIcon name="leave" />
          </button>
        )}
      </div>

      <div
        class="td-v2-stats"
        style={`grid-template-columns:repeat(${stats.length},1fr)`}
      >
        {stats.map(([label, val, sub, tab]) => {
          const linked = tabKeys.has(tab);
          return (
            <button
              key={label}
              type="button"
              class={`td-v2-stat${linked ? ' is-link' : ''}`}
              data-td-v2-action="tab"
              data-tab={tab}
              disabled={!linked}
              onClick={() => onSelectTab(tab)}
            >
              <span class="td-v2-stat-num">{val}</span>
              <span class="td-v2-stat-label">
                {label}
                {sub ? <span>{sub}</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div class="td-v2-tab-rail">
        <div class="td-v2-tab-list" role="tablist">
          {tabs.map((item) => {
            const isActive = activeTab === item.key;
            const cls = isActive ? 'active' : '';
            return (
              <button
                key={item.key}
                class={cls}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-td-v2-action="tab"
                data-tab={item.key}
                onClick={() => onSelectTab(item.key)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
