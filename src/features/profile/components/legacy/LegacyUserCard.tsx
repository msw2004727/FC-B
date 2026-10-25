import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { emit } from '@/core/events';
import { SHOW_EXP } from '@/core/exp-display';
import { useIdentitySettings } from '@/data/identity-settings';
import { getEffectiveIdentity } from '@/data/identity-resolver';
import { lt } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import {
  loadUserAttendanceSummary,
  type UserAttendanceSummary,
} from '../../data/attendance-summary';
import {
  formatUserAttendanceSummaryTime,
  getFilteredRecords,
  loadUserStats,
  type UserStatsSnapshot,
} from '../../data/activity-records';
import { BASE_ROLE_LEVEL_MAP } from '../../data/permissions';
import { loadUserProfile, type UserProfile } from '../../data/profile-model';
import { useViewer } from '../../data/viewer';
import { SocialLinks } from '../../ui/shared';
import { ActivityRecordList } from './ActivityRecordList';
import { LegacyAvatar } from './LegacyProfileHeader';
import { UserCardBadges } from './UserCardBadges';
import {
  ROLE_DISPLAY_MAP,
  UNAVAILABLE_MSG,
  calcLevelFromExp,
  formatCreatedAt,
  getUserTeamEntries,
  resolveEffectiveRole,
  sanitizeHttpAvatarUrl,
} from './profile-legacy-helpers';

type RecordFilter = 'all' | 'completed' | 'cancelled';

export interface LegacyUserCardProps {
  uid: string;
}

/**
 * 照 A `profile-core.js#showUserProfile`：他人名片（`.user-card-full#user-card-full`）。
 * 站長改良：聯繫方式（電話）只在「本人」或「全域管理員（role level >= admin）」時渲染；
 * 其他人整列不輸出到 DOM。
 *
 * ASSUMPTION: A `_buildUserCardActionPanel`／`buildTitleDisplayHtml`／`buildEarnedBadgeListHtml` 屬資料層
 * （第 4 段接上），本段先略過 action panel、以 `profile.displayName` 作標題、徽章交給 `UserCardBadges` 空狀態。
 * ASSUMPTION: A `_buildSocialLinksHtml` 借用既有 `SocialLinks`（B 已輸出 A 的社群 DOM）。
 * ASSUMPTION: A `_getUserTeamHtml` 的連結 URL 未附原始碼，用 `#page-team?id={id}`。
 */
export function LegacyUserCard({ uid }: LegacyUserCardProps): JSX.Element {
  const viewer = useViewer();
  const location = useLocation();
  const identitySettings = useIdentitySettings();
  const targetUid = uid;
  const isSelf = Boolean(viewer.uid && viewer.uid === targetUid);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const mountedRef = useRef(true);
  // 活動紀錄載入世代：換看另一個人時遞增，前一人還在飛的結果不得寫進新的名片。
  const recordsSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 照 A `showUserProfile`：以 UID 讀取目標用戶。
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setProfile(null);
    loadUserProfile(targetUid)
      .then((p) => {
        if (cancelled || !mountedRef.current) return;
        if (!p) {
          setStatus('missing');
          return;
        }
        setProfile(p);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        // eslint-disable-next-line no-console
        console.warn('[legacy-user-card] load failed', err);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [targetUid]);

  // 照 A `_requireProtectedActionLogin`：未登入用既有事件導向登入。
  useEffect(() => {
    if (!viewer.uid) emit('auth:login-request', {});
  }, [viewer.uid]);

  // 活動紀錄（照 A `renderUserCardRecords`：初次以毛玻璃遮蔽，點擊後才讀）。
  const [stats, setStats] = useState<UserStatsSnapshot | null>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<RecordFilter | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    recordsSeqRef.current += 1;
    setStats(null);
    setSummary(null);
    setRecordsLoaded(false);
    setRecordsLoading(false);
    setActiveFilter(null);
    setPage(1);
  }, [targetUid]);

  if (status === 'loading') {
    return (
      <div class="user-card-full" id="user-card-full">
        <div class="info-card">
          <div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">
            {lt('載入中...', '載入中...')}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div class="user-card-full" id="user-card-full">
        <div class="info-card">
          <div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">
            {lt('找不到用戶資料', '找不到用戶資料')}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error' || !profile) {
    return (
      <div class="user-card-full" id="user-card-full">
        <div class="info-card">
          <div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">
            {lt('載入失敗，請稍後再試', '載入失敗，請稍後再試')}
          </div>
        </div>
      </div>
    );
  }

  // 名稱與頭像：看別人＝對方主身份；看自己＝getEffectiveIdentity（surface=profile）可帶第二身份。
  const identity = getEffectiveIdentity(
    {
      uid: profile.uid,
      displayName:
        typeof profile['displayName'] === 'string' ? profile['displayName'] : null,
      name: profile.name,
      pictureUrl:
        typeof profile['pictureUrl'] === 'string' ? profile['pictureUrl'] : null,
      photoURL: typeof profile['picture'] === 'string' ? profile['picture'] : null,
    },
    isSelf
      ? {
        settings: identitySettings,
        surface: 'profile',
        allowSecondaryIdentity: viewer.hasPermission('profile.secondary_identity'),
      }
      : { allowSecondaryIdentity: false },
  );

  const isSecondaryIdentity = isSelf && identity?.identityId === 'secondary';

  const displayName = isSelf && identity
    ? ((identity.displayName || '').trim() || profile.name || '-')
    : ((typeof profile['displayName'] === 'string' ? profile['displayName'] : '')
      || profile.name
      || '-');

  const rawAvatar = isSelf && identity
    ? identity.pictureUrl
    : (typeof profile['pictureUrl'] === 'string' ? profile['pictureUrl'] : null);
  const avatarUrl = sanitizeHttpAvatarUrl(rawAvatar);

  const effectiveRole = resolveEffectiveRole(profile);
  const roleInfo = ROLE_DISPLAY_MAP[effectiveRole] ?? ROLE_DISPLAY_MAP.user;

  const gender = typeof profile['gender'] === 'string' ? profile['gender'] : '-';
  const birthday = typeof profile['birthday'] === 'string' ? profile['birthday'] : '-';
  const region = typeof profile['region'] === 'string' ? profile['region'] : '-';
  const sports = (() => {
    const v = profile['sports'];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v)) {
      const s = v.filter((x): x is string => typeof x === 'string').join('、');
      return s || '-';
    }
    return '-';
  })();
  const phone = typeof profile['phone'] === 'string' ? profile['phone'] : '-';
  const joinDate = formatCreatedAt(profile['createdAt']);

  const teamEntries = getUserTeamEntries(profile);

  // 站長改良：只有本人或全域管理員（role level >= admin）看得到聯繫方式；其他人整列不輸出。
  const adminLevel = BASE_ROLE_LEVEL_MAP['admin'] ?? 4;
  const viewerLevel = BASE_ROLE_LEVEL_MAP[viewer.role] ?? 0;
  const canSeePhone = Boolean(viewer.uid && viewer.uid === profile.uid)
    || viewerLevel >= adminLevel;

  const { level, progress, needed, percent: expPct } = calcLevelFromExp(profile['exp'] ?? 0);

  // 照 A `renderUserCardRecords` + `refreshUserCardRecords`：一次取回活動紀錄與統計。
  const loadRecords = (): void => {
    if (recordsLoading) return;
    const seq = ++recordsSeqRef.current;
    setRecordsLoading(true);
    Promise.all([
      loadUserStats(profile.uid),
      loadUserAttendanceSummary(profile.uid),
    ])
      .then(([s, sum]) => {
        if (!mountedRef.current || seq !== recordsSeqRef.current) return;
        setStats(s);
        setSummary(sum);
        setRecordsLoaded(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[legacy-user-card] records load failed', err);
      })
      .finally(() => {
        if (!mountedRef.current || seq !== recordsSeqRef.current) return;
        setRecordsLoading(false);
      });
  };

  const effectiveFilter: RecordFilter = activeFilter ?? 'all';
  const filteredRecords = stats && stats.uid === profile.uid
    ? getFilteredRecords(stats, effectiveFilter, true)
    : [];

  const handleShareClick = (): void => {
    // ASSUMPTION: B 尚無個人名片分享功能（本單範圍外），照 A 輸出按鈕但點擊 toast 提示。
    toast.show({ message: UNAVAILABLE_MSG });
  };

  const body = (
    <>
      <SocialLinks profile={profile} />
      <div class="info-card">
        <div class="info-title">{lt('基本資料', '基本資料')}</div>
        <div class="info-row">
          <span>{lt('性別', '性別')}</span>
          <span>{gender}</span>
        </div>
        <div class="info-row">
          <span>{lt('生日', '生日')}</span>
          <span>{birthday}</span>
        </div>
        <div class="info-row">
          <span>{lt('地區', '地區')}</span>
          <span>{region}</span>
        </div>
        <div class="info-row">
          <span>{lt('運動類別', '運動類別')}</span>
          <span>{sports}</span>
        </div>
        <div class="info-row">
          <span>{lt('所屬俱樂部', '所屬俱樂部')}</span>
          <span class="uc-team-list">
            {teamEntries.length === 0
              ? lt('無', '無')
              : teamEntries.map((entry, i) => (
                // 照 A _getUserTeamHtml：每個俱樂部一個 .uc-team-link 膠囊，點擊開俱樂部頁，不加分隔字。
                <span
                  key={entry.id || `${entry.name}-${i}`}
                  class="uc-team-link"
                  onClick={() => {
                    if (entry.id) location.route(`/teams/${encodeURIComponent(entry.id)}`);
                  }}
                >
                  {entry.name}
                </span>
              ))}
          </span>
        </div>
        {canSeePhone ? (
          <div class="info-row">
            <span>{lt('聯繫方式', '聯繫方式')}</span>
            <span>{phone}</span>
          </div>
        ) : null}
        <div class="info-row">
          <span>{lt('加入時間', '加入時間')}</span>
          <span>{joinDate}</span>
        </div>
      </div>
      <UserCardBadges uid={profile.uid} isSelf={isSelf} />
      <div class="info-card">
        <div class="info-title profile-record-title-row">
          <span>{lt('活動紀錄', '活動紀錄')}</span>
          <span class="profile-record-sync-meta">
            <span id="uc-records-updated-at" class="profile-record-updated-at">
              {lt('資料更新', '資料更新')} {formatUserAttendanceSummaryTime(summary?.updatedAt)}
            </span>
            <button
              id="uc-records-refresh"
              class="profile-record-refresh-btn"
              type="button"
              onClick={loadRecords}
              title={lt('重新整理', '重新整理')}
              aria-label={lt('重新整理', '重新整理')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </span>
        </div>
        <div class="profile-stats" style="margin:-.2rem 0 .5rem" id="uc-record-stats">
          <div class="stat-item">
            <span class="stat-num" id="uc-stat-total">{summary?.expectedCount ?? '--'}</span>
            <span class="stat-label">{lt('應到場次', '應到場次')}</span>
          </div>
          <div class="stat-item">
            <span class="stat-num" id="uc-stat-done">{summary?.completedCount ?? '--'}</span>
            <span class="stat-label">{lt('完成場次', '完成場次')}</span>
          </div>
          <div class="stat-item">
            <span class="stat-num" id="uc-stat-rate">
              {summary ? `${summary.attendRate}%` : '--'}
            </span>
            <span class="stat-label">{lt('出席率', '出席率')}</span>
          </div>
          <div class="stat-item">
            {/* ASSUMPTION: 徽章數由第 4 段接上；本段固定 `--`。 */}
            <span class="stat-num" id="uc-stat-badges">--</span>
            <span class="stat-label">{lt('徽章', '徽章')}</span>
          </div>
        </div>
        <div class="tab-bar compact" id="uc-record-tabs">
          <button
            class={`tab${activeFilter === 'all' ? ' active' : ''}`}
            data-filter="all"
            onClick={() => {
              setActiveFilter('all');
              setPage(1);
            }}
          >
            {lt('全部', '全部')}
          </button>
          <button
            class={`tab${activeFilter === 'completed' ? ' active' : ''}`}
            data-filter="completed"
            onClick={() => {
              setActiveFilter('completed');
              setPage(1);
            }}
          >
            {lt('完成', '完成')}
          </button>
          <button
            class={`tab${activeFilter === 'cancelled' ? ' active' : ''}`}
            data-filter="cancelled"
            onClick={() => {
              setActiveFilter('cancelled');
              setPage(1);
            }}
          >
            {lt('取消', '取消')}
          </button>
        </div>
        <div class="mini-activity-list" id="uc-activity-records">
          {recordsLoaded ? (
            <ActivityRecordList items={filteredRecords} page={page} onPage={setPage} />
          ) : null}
        </div>
        {!recordsLoaded ? (
          <div class="uc-blur-overlay" onClick={loadRecords}>
            <div class="uc-blur-text">{lt('點擊載入活動記錄', '點擊載入活動記錄')}</div>
          </div>
        ) : null}
      </div>
      <div style="text-align:center;padding:.5rem 0 1rem">
        <button
          class="outline-btn"
          style="font-size:.78rem;padding:.4rem 1rem;display:inline-flex;align-items:center;gap:.3rem"
          data-profile-share-name={displayName}
          onClick={handleShareClick}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          {lt('分享名片', '分享名片')}
        </button>
      </div>
    </>
  );

  return (
    <div
      class={`user-card-full${isSecondaryIdentity ? ' is-secondary-private' : ''}`}
      id="user-card-full"
    >
      <div class="uc-header">
        <div class="uc-avatar-circle" style="margin:0 auto .6rem">
          <LegacyAvatar url={avatarUrl} name={displayName} baseClass="uc-avatar-circle" />
        </div>
        <div class="profile-title" data-no-translate="">{displayName}</div>
        {!isSecondaryIdentity ? (
          <div style="margin-top:.3rem">
            <span
              class="uc-role-tag"
              style={`background:${roleInfo.color}22;color:${roleInfo.color}`}
            >
              {lt(roleInfo.label, roleInfo.label)}
            </span>
          </div>
        ) : null}
        {!isSecondaryIdentity && SHOW_EXP ? (
          <div class="profile-level">
            <span>Lv.{level}</span>
            <div class="exp-bar">
              <div class="exp-fill" style={`width:${expPct}%`} />
            </div>
            <span class="exp-text">
              {progress.toLocaleString()} / {needed.toLocaleString()}
            </span>
          </div>
        ) : null}
      </div>
      {isSecondaryIdentity ? (
        <div class="uc-secondary-private-wrap">
          <div class="uc-secondary-private-content">{body}</div>
          <div class="uc-secondary-private-overlay" aria-hidden="true">
            <span>{lt('次身份已隱藏詳細資料', '次身份已隱藏詳細資料')}</span>
          </div>
        </div>
      ) : (
        body
      )}
    </div>
  );
}
