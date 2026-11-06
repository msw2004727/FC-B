import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { emit } from '@/core/events';
import { SHOW_EXP } from '@/core/exp-display';
import { LOCKED_FEATURE_MSG } from '@/core/unavailable';
import { useIdentitySettings } from '@/data/identity-settings';
import { getEffectiveIdentity } from '@/data/identity-resolver';
import { openPmDialog } from '@/features/inbox/components/pm-dialog-store';
import { lt, useT } from '@/i18n/i18n';
import { resolveDrawerRoleInfo, type CustomRoleInput } from '@/ui/drawer-menu';
import { toast } from '@/ui/Toast';

import type { UserAttendanceSummary } from '../../data/attendance-summary';
import { getFilteredRecords, type UserStatsSnapshot } from '../../data/activity-records';
import { BASE_ROLE_LEVEL_MAP } from '../../data/permissions';
import { loadUserProfile, type UserProfile } from '../../data/profile-model';
import {
  getPublicStats,
  getPublicSummary,
  loadCustomRolesCached,
  peekPublicStats,
  peekPublicSummary,
} from '../../data/public-profile-cache';
import { useViewer } from '../../data/viewer';
import { ActivityRecordList } from './ActivityRecordList';
import { LegacyAvatar } from './LegacyProfileHeader';
import { LegacySocialLinks } from './LegacyProfileSocialAndRelated';
import {
  ROLE_DISPLAY_MAP,
  UNAVAILABLE_MSG,
  calcLevelFromExp,
  formatCreatedAt,
  getUserTeamEntries,
  resolveEffectiveRole,
  sanitizeHttpAvatarUrl,
} from './profile-legacy-helpers';
import './public-profile.css';

type RecordFilter = 'all' | 'completed' | 'cancelled';

/** A `isValidLineUid`：私訊只開給合法 LINE UID。 */
const LINE_UID_RE = /^U[0-9a-f]{32}$/i;
/** 自訂角色色碼只收 #hex，其他退回 A 的預設色（色碼會寫進 style）。 */
const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const CUSTOM_ROLE_FALLBACK_COLOR = '#6366f1';

export interface LegacyUserCardProps {
  uid: string;
}

/** 24×24 細線圖示（設計預覽 public-profile-redesign-2026-11-06 的 symbol）。 */
function LineIcon({ children }: { children: ComponentChildren }): JSX.Element {
  return (
    <svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/**
 * 11-06 他人公開個人頁改版（站長選定「A 名片型」，設計 docs/previews/public-profile-redesign-2026-11-06）。
 * 版面：頭像／名字／身分 → 私訊・加好友・關注 → 社群 → 細分隔線 → 三格統計 → 資料列表 → 「活動明細 N」整列按鈕 → 分享名片。
 * - 三格統計開頁自動讀 userAttendanceStats（1 次讀取）；活動明細點開才讀（loadUserStats）。
 *   同一工作階段同一 uid 5 分鐘內不重讀（public-profile-cache），重新整理鈕強制重讀。取代原本整卡灰色遮罩「點擊載入」。
 * - 徽章格移除（站長 11-02 成就／徽章移除）。
 * - 聯繫方式只在本人或全域管理員（role level >= admin）時輸出到 DOM（站長改良，沿用）。
 * - 私訊照 A `_buildUserCardActionPanel`＋`pm-entry.js`：看自己不顯示整排動作；對方不是合法 LINE UID 不顯示私訊；
 *   未登入按私訊改導登入。加好友、關注照 A 顯示「功能尚未開放」。
 */
export function LegacyUserCard({ uid }: LegacyUserCardProps): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const identitySettings = useIdentitySettings();
  const targetUid = uid;
  const isSelf = Boolean(viewer.uid && viewer.uid === targetUid);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  // status／profile 是為哪個「請求 uid」載入的。不能拿 profile.uid 比對：它可能是 lineUserId 或 doc id
  // （mapUserProfileDoc 的 uid || lineUserId || docId），不一定等於請求的 uid。
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // 統計／明細載入世代：換看另一個人時遞增，前一人還在飛的結果不得寫進新的名片。
  const recordsSeqRef = useRef(0);
  // 換人世代（只在換看另一個人時遞增）：三格統計自動讀用它判斷，按明細不會讓它作廢。
  const uidSeqRef = useRef(0);

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
    setLoadedFor(null);
    loadUserProfile(targetUid)
      .then((p) => {
        if (cancelled || !mountedRef.current) return;
        setLoadedFor(targetUid);
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
        setLoadedFor(targetUid);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [targetUid]);

  // 照 A `_requireProtectedActionLogin`：未登入用既有事件導向登入。
  // auto：掛載自動要求，剛取消授權或剛登出時 App 會略過，避免反覆送去 LINE（Grok 第二輪 P1）。
  useEffect(() => {
    if (!viewer.uid) emit('auth:login-request', { auto: true });
  }, [viewer.uid]);

  const [stats, setStats] = useState<UserStatsSnapshot | null>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState(false);
  const [activeFilter, setActiveFilter] = useState<RecordFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    recordsSeqRef.current += 1;
    uidSeqRef.current += 1;
    setStats(null);
    setSummary(null);
    setRecordsOpen(false);
    setRecordsLoading(false);
    setRecordsError(false);
    setActiveFilter('all');
    setPage(1);
  }, [targetUid]);

  // 讀到資料的那個 uid（可能是 lineUserId／doc id 後備查到的 profile.uid）。
  const dataUid = status === 'ready' && loadedFor === targetUid && profile ? profile.uid : '';

  // 三格統計：開頁自動讀一次（快取命中不讀）。
  useEffect(() => {
    if (!dataUid) return;
    const cached = peekPublicSummary(dataUid);
    if (cached) {
      setSummary(cached);
      return;
    }
    const seq = uidSeqRef.current;
    getPublicSummary(dataUid)
      .then((sum) => {
        if (!mountedRef.current || seq !== uidSeqRef.current) return;
        setSummary(sum);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[legacy-user-card] summary load failed', err);
      });
  }, [dataUid]);

  // 對方是自訂角色、且已登入（customRoles 規則要登入才能讀）時才讀，整個工作階段一次。
  const rawRoleKey = profile && typeof profile['role'] === 'string' ? profile['role'].trim() : '';
  const isCustomRole = Boolean(rawRoleKey)
    && !Object.prototype.hasOwnProperty.call(ROLE_DISPLAY_MAP, rawRoleKey);
  const [customRoles, setCustomRoles] = useState<readonly CustomRoleInput[] | null>(null);
  const signedIn = Boolean(viewer.uid);
  useEffect(() => {
    if (!isCustomRole || !signedIn) return;
    let cancelled = false;
    void loadCustomRolesCached().then((roles) => {
      if (!cancelled && mountedRef.current) setCustomRoles(roles);
    });
    return () => {
      cancelled = true;
    };
  }, [isCustomRole, signedIn]);

  // 換看另一個人的那一個 render（effect 清狀態之前）：資料不是為目前 uid 載入的，一律當載入中，不顯示上一人。
  if (status === 'loading' || loadedFor !== targetUid) {
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

  // 身分標籤：直接用剛讀到的對方文件（resolveEffectiveRole 已處理隱身管理員）；不另用 useUserRoles，
  // 省一次 users 讀取，也避免網址 uid 與文件 id 不同時查錯對象（審查 P2-1，取代原本同頁首的 useUserRoles 寫法）。
  // 自訂角色照 A ROLES Proxy 顯示自訂名稱與顏色。
  const customInfo = isCustomRole ? resolveDrawerRoleInfo(rawRoleKey, true, customRoles) : null;
  const roleInfo = customInfo
    ? { label: customInfo.label, color: HEX_COLOR_RE.test(customInfo.color) ? customInfo.color : CUSTOM_ROLE_FALLBACK_COLOR }
    : (ROLE_DISPLAY_MAP[resolveEffectiveRole(profile)] ?? ROLE_DISPLAY_MAP.user);

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

  // 看自己：網址 uid 或讀到的文件 uid 任一等於登入者都算（不能私訊自己）。
  const viewingSelf = isSelf || Boolean(viewer.uid && viewer.uid === profile.uid);
  const pmUid = String(profile.uid || '').trim();
  const canPm = !viewingSelf && LINE_UID_RE.test(pmUid);

  const handlePm = (): void => {
    if (!viewer.uid) {
      emit('auth:login-request', {});
      return;
    }
    openPmDialog({
      uid: pmUid,
      name: displayName,
      ...(avatarUrl ? { pictureUrl: avatarUrl } : {}),
    });
  };
  const handleNotOpen = (): void => {
    toast.show({ message: lt(LOCKED_FEATURE_MSG, LOCKED_FEATURE_MSG) });
  };

  // 活動明細：點開才讀；force＝重新整理鈕（明細與三格統計一起重讀）。
  const loadRecords = (force: boolean): void => {
    if (recordsLoading) return;
    const seq = ++recordsSeqRef.current;
    const statsUid = profile.uid;
    setRecordsLoading(true);
    setRecordsError(false);
    Promise.all([
      getPublicStats(statsUid, { force }),
      force ? getPublicSummary(statsUid, { force: true }) : Promise.resolve(null),
    ])
      .then(([s, sum]) => {
        if (!mountedRef.current || seq !== recordsSeqRef.current) return;
        setStats(s);
        if (sum) setSummary(sum);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[legacy-user-card] records load failed', err);
        // 照 A refreshUserCardRecords 失敗時 showToast('活動紀錄刷新失敗')；已換人或卸載就不提示。
        if (!mountedRef.current || seq !== recordsSeqRef.current) return;
        setRecordsError(true);
        toast.show({ message: lt('活動紀錄刷新失敗', '活動紀錄刷新失敗') });
      })
      .finally(() => {
        if (!mountedRef.current || seq !== recordsSeqRef.current) return;
        setRecordsLoading(false);
      });
  };

  const recordsReady = Boolean(stats && stats.uid === profile.uid);

  const toggleRecords = (): void => {
    const next = !recordsOpen;
    setRecordsOpen(next);
    if (!next || recordsReady) return;
    const cached = peekPublicStats(profile.uid);
    if (cached) {
      setStats(cached);
      return;
    }
    loadRecords(false);
  };

  const filteredRecords = recordsReady && stats
    ? getFilteredRecords(stats, activeFilter, true)
    : [];
  // 「活動明細 N」固定用三格統計的應到場次，展開前後數字不跳（審查 P3-4）。
  const recordCount = summary?.expectedCount ?? null;

  const handleShareClick = (): void => {
    // ASSUMPTION: B 尚無個人名片分享功能（本單範圍外），照 A 輸出按鈕但點擊 toast 提示。
    toast.show({ message: UNAVAILABLE_MSG });
  };

  const statNum = (value: number | undefined): string =>
    typeof value === 'number' ? String(value) : '--';

  const filters: { key: RecordFilter; label: string }[] = [
    { key: 'all', label: lt('全部', '全部') },
    { key: 'completed', label: lt('完成', '完成') },
    { key: 'cancelled', label: lt('取消', '取消') },
  ];

  const header = (
    <div class="uc-header pp-hd">
      <div class="uc-avatar-circle">
        <LegacyAvatar url={avatarUrl} name={displayName} baseClass="uc-avatar-circle" />
      </div>
      <div class="profile-title" data-no-translate="">{displayName}</div>
      {!isSecondaryIdentity ? (
        <span class="uc-role-tag pp-role" style={`color:${roleInfo.color}`}>
          {lt(roleInfo.label, roleInfo.label)}
        </span>
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
      {!viewingSelf && !isSecondaryIdentity ? (
        <div class="pp-acts" role="group" aria-label={t('profile.pp.actions')}>
          {canPm ? (
            <button type="button" class="pp-ab pp-pri" data-action="pm" onClick={handlePm}>
              <LineIcon>
                <path d="M4 5.5h16a1 1 0 011 1V16a1 1 0 01-1 1h-9l-4.5 3.5V17H4a1 1 0 01-1-1V6.5a1 1 0 011-1z" />
                <path d="M7.5 10h9M7.5 13.2h5.5" />
              </LineIcon>
              <span>{t('profile.pp.pm')}</span>
            </button>
          ) : null}
          <button type="button" class="pp-ab" data-action="friend" onClick={handleNotOpen}>
            <LineIcon>
              <circle cx="9.5" cy="8.5" r="3.3" />
              <path d="M3.5 19.5c.7-3.3 3-5.1 6-5.1 1.6 0 3 .5 4.1 1.5" />
              <path d="M18 13.5v6M15 16.5h6" />
            </LineIcon>
            <span>{t('profile.pp.addFriend')}</span>
          </button>
          <button type="button" class="pp-ab" data-action="follow" onClick={handleNotOpen}>
            <LineIcon>
              <path d="M12 3.8l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.2l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />
            </LineIcon>
            <span>{t('profile.pp.follow')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );

  const statsBlock = (
    <>
      <LegacySocialLinks profile={profile} />
      <div class="pp-sep" role="separator" />
      <div class="pp-stats" id="uc-record-stats">
        <div>
          <b id="uc-stat-total">{statNum(summary?.expectedCount)}</b>
          <span>{t('profile.pp.expected')}</span>
        </div>
        <div>
          <b id="uc-stat-done">{statNum(summary?.completedCount)}</b>
          <span>{t('profile.pp.completed')}</span>
        </div>
        <div class="pp-hi">
          <b id="uc-stat-rate">
            {summary ? (
              <>
                {summary.attendRate}
                <small>%</small>
              </>
            ) : '--'}
          </b>
          <span>{lt('出席率', '出席率')}</span>
        </div>
      </div>
    </>
  );

  const details = (
    <>
      <div class="pp-h">{t('profile.pp.info')}</div>
      <div class="pp-rows">
        <div class="pp-row">
          <span>{lt('性別', '性別')}</span>
          <span>{gender}</span>
        </div>
        <div class="pp-row">
          <span>{lt('生日', '生日')}</span>
          <span>{birthday}</span>
        </div>
        <div class="pp-row">
          <span>{lt('地區', '地區')}</span>
          <span>{region}</span>
        </div>
        <div class="pp-row">
          <span>{lt('運動類別', '運動類別')}</span>
          <span>{sports}</span>
        </div>
        <div class="pp-row">
          <span>{lt('所屬俱樂部', '所屬俱樂部')}</span>
          <span class="pp-clubs">
            {teamEntries.length === 0
              ? lt('無', '無')
              : teamEntries.map((entry, i) => (
                // 照 A _getUserTeamHtml：每個俱樂部各一個連結，點擊開俱樂部頁。
                <button
                  key={entry.id || `${entry.name}-${i}`}
                  type="button"
                  class="pp-club"
                  disabled={!entry.id}
                  onClick={() => {
                    if (entry.id) location.route(`/teams/${encodeURIComponent(entry.id)}`);
                  }}
                >
                  <span>{entry.name}</span>
                  {entry.id ? (
                    <LineIcon>
                      <path d="M9.5 6l6 6-6 6" />
                    </LineIcon>
                  ) : null}
                </button>
              ))}
          </span>
        </div>
        {canSeePhone ? (
          <div class="pp-row">
            <span>{lt('聯繫方式', '聯繫方式')}</span>
            <span>{phone}</span>
          </div>
        ) : null}
        <div class="pp-row">
          <span>{lt('加入時間', '加入時間')}</span>
          <span>{joinDate}</span>
        </div>
      </div>
      <button
        type="button"
        class="pp-more"
        id="uc-records-toggle"
        aria-expanded={recordsOpen ? 'true' : 'false'}
        aria-controls="uc-records-panel"
        onClick={toggleRecords}
      >
        <span>
          {t('profile.pp.records')}
          {recordCount !== null ? <span class="pp-cnt">{recordCount}</span> : null}
        </span>
        <LineIcon>
          <path d="M6 9.5l6 6 6-6" />
        </LineIcon>
      </button>
      <div class="pp-recs" id="uc-records-panel" hidden={!recordsOpen}>
        <div class="pp-tabs-row">
          <div class="pp-tabs" id="uc-record-tabs" role="tablist">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                class="pp-tab"
                data-filter={f.key}
                aria-selected={activeFilter === f.key ? 'true' : 'false'}
                onClick={() => {
                  setActiveFilter(f.key);
                  setPage(1);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            id="uc-records-refresh"
            class={`pp-refresh${recordsLoading ? ' spinning' : ''}`}
            type="button"
            onClick={() => loadRecords(true)}
            title={lt('重新整理', '重新整理')}
            aria-label={lt('重新整理', '重新整理')}
          >
            <LineIcon>
              <path d="M20 5v5h-5" />
              <path d="M4 19v-5h5" />
              <path d="M5.6 9a7 7 0 0 1 12.2-2.4L20 10M4 14l2.2 3.4A7 7 0 0 0 18.4 15" />
            </LineIcon>
          </button>
        </div>
        <div class="mini-activity-list" id="uc-activity-records">
          {recordsReady ? (
            <ActivityRecordList items={filteredRecords} page={page} onPage={setPage} />
          ) : recordsError && !recordsLoading ? (
            <div class="pp-loading pp-error">
              <span>{lt('活動紀錄刷新失敗', '活動紀錄刷新失敗')}</span>
              <button type="button" class="pp-retry" onClick={() => loadRecords(false)}>
                {lt('重試', '重試')}
              </button>
            </div>
          ) : (
            <div class="pp-loading">{lt('載入中...', '載入中...')}</div>
          )}
        </div>
      </div>
      <div class="pp-share">
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

  // 看自己且用第二身份：照 A，頭像與名字照常顯示，其餘以遮罩蓋住。
  if (isSecondaryIdentity) {
    return (
      <div class="user-card-full pp-card is-secondary-private" id="user-card-full">
        {header}
        <div class="uc-secondary-private-wrap">
          <div class="uc-secondary-private-content">
            {statsBlock}
            {details}
          </div>
          <div class="uc-secondary-private-overlay" aria-hidden="true">
            <span>{lt('次身份已隱藏詳細資料', '次身份已隱藏詳細資料')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="user-card-full pp-card" id="user-card-full">
      {header}
      {statsBlock}
      <div class="pp-right">{details}</div>
    </div>
  );
}
