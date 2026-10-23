import type { JSX } from 'preact';
import { SPORTS } from '@/features/events/data/sports';
import type { ClubViewer, TeamDoc, TeamPrimaryAction } from '../../data/types';
import {
  getTeamCoverImageUrl,
  getTeamRank,
  isTeamTeachingTagged,
} from '../../data/team-list-model';

// U-020：共用 core/unavailable 的提示文字。
export { UNAVAILABLE_FEATURE_MSG as UNAVAILABLE_MSG } from '@/core/unavailable';

export type V2TabKey = 'overview' | 'courses' | 'events' | 'members' | 'record' | 'feed';

export interface V2TabDef {
  key: V2TabKey;
  label: string;
  badge?: number;
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
  if (!isTeamTeachingTagged(team)) return '一般俱樂部 · 歡迎查看活動與成員';
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
  if (!team || !viewer?.uid) return false;
  const uid = viewer.uid;
  const teamId = String(team.id ?? '').trim();
  const isMember = Boolean(teamId && viewer.teamIds.has(teamId));
  const isCaptain = String(team.captainUid ?? '').trim() === uid;
  const isCoach =
    Array.isArray(team.coachUids) &&
    team.coachUids.some((id) => String(id ?? '').trim() === uid);
  return isCaptain || isCoach || (isMember && team['allowMemberInvite'] !== false);
}

function SvgIcon({ name }: { name: 'back' | 'more' | 'camera' | 'join' | 'check' | 'share' | 'contact' | 'qr' | 'leave' }): JSX.Element {
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
    case 'share':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
          <path d="M16 6l-4-4-4 4" />
          <path d="M12 2v14" />
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
  onContact: () => void;
  onUnavailable: () => void;
  onJoin: () => void;
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
  onContact,
  onUnavailable,
  onJoin,
  onJoined,
  onJoinPending,
  onLeave,
  onSelectTab,
}: TeamDetailV2HeaderProps): JSX.Element {
  const sportLabel = getSportLabel(team);
  const subtitle = team.nameEn || sportLabel || team.region || 'Club detail';
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

  const stats: ReadonlyArray<[string, string | number, string]> = [
    ['成員', memberCount, ''],
    ['課程', courseCount, ''],
    ['勝率', totalGames > 0 ? `${winRate}%` : '-', totalGames > 0 ? `${totalGames} 場` : ''],
    ['活動', eventCount, ''],
  ];

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
          <div class="td-v2-subtitle">{subtitle}</div>
        </div>
        {/* 下一批補：更多操作／設定與分享 */}
        <button
          class="td-v2-icon-btn"
          type="button"
          data-td-v2-action="more"
          aria-label="更多操作"
          onClick={onUnavailable}
        >
          <SvgIcon name="more" />
        </button>
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
          /* 下一批補：更換俱樂部封面 */
          <button
            class="td-v2-cover-edit"
            type="button"
            data-td-v2-action="edit-cover"
            aria-label="更換俱樂部封面"
            title="更換俱樂部封面"
            onClick={onUnavailable}
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
              /* 下一批補：更換俱樂部頭像 */
              <button
                class="td-v2-avatar-edit"
                type="button"
                data-td-v2-action="edit-avatar"
                aria-label="更換俱樂部頭像"
                title="更換俱樂部頭像"
                onClick={onUnavailable}
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
        <div class="td-v2-hero-status">
          <span class="td-v2-pulse" />
          <span class="td-v2-hero-status-text">{recruitText}</span>
          <span
            class="td-v2-hero-rank"
            style={{ '--td-v2-rank-color': detailRank.color || '#94a3b8' }}
          >
            <span>{exp.toLocaleString()}</span>
            <strong>{detailRank.rank || 'E'}</strong>
          </span>
        </div>
      </section>

      <div class={`td-v2-cta-bar${isMember ? ' has-leave' : ''}`}>
        {primaryAction === 'pending' ? (
          <button
            class="td-v2-cta-primary pending"
            type="button"
            data-td-v2-action="join-pending"
            disabled={busy}
            onClick={onJoinPending}
          >
            <SvgIcon name="check" />
            <span>審核中</span>
          </button>
        ) : isMember ? (
          <button
            class="td-v2-cta-primary joined"
            type="button"
            data-td-v2-action="joined"
            disabled={busy}
            onClick={onJoined}
          >
            <SvgIcon name="check" />
            <span>已加入</span>
          </button>
        ) : (
          <button
            class="td-v2-cta-primary"
            type="button"
            data-td-v2-action="join"
            disabled={busy}
            onClick={onJoin}
          >
            <SvgIcon name="join" />
            <span>加入俱樂部</span>
          </button>
        )}
        {/* 下一批補：分享俱樂部 */}
        <button
          class="td-v2-cta-icon"
          type="button"
          data-td-v2-action="share"
          aria-label="分享俱樂部"
          onClick={onUnavailable}
        >
          <SvgIcon name="share" />
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
        {/* 下一批補：邀請 QR */}
        <button
          class="td-v2-cta-icon"
          type="button"
          data-td-v2-action="invite"
          disabled={!canInvite}
          aria-disabled={!canInvite ? 'true' : undefined}
          aria-label="邀請 QR"
          onClick={onUnavailable}
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

      <div class="td-v2-stats">
        {stats.map(([label, val, sub]) => (
          <div key={label} class="td-v2-stat">
            <div class="td-v2-stat-num">{val}</div>
            <div class="td-v2-stat-label">
              {label}
              {sub ? <span>{sub}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div class="td-v2-tab-rail">
        <div class="td-v2-tab-list" role="tablist">
          {tabs.map((item) => {
            const isActive = activeTab === item.key;
            const liveClass = item.key === 'courses' && (item.badge ?? 0) > 0 ? 'td-course-tab-live' : '';
            const cls = [isActive ? 'active' : '', liveClass].filter(Boolean).join(' ');
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
                {item.badge ? <span class="td-v2-tab-badge">{item.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
