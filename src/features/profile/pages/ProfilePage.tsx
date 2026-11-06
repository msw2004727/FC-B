import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { emit } from '@/core/events';
import { useGoBack } from '@/core/back-guard';
import { SHOW_FAVORITES } from '@/core/hidden-features';
import { lt, useT } from '@/i18n/i18n';
import { useViewer, type ViewerView } from '../data/viewer';
import { loadUserProfile, type UserProfile } from '../data/profile-model';
import {
  loadUserAttendanceSummary,
  type UserAttendanceSummary,
} from '../data/attendance-summary';
import { useSummarySequencer } from '../data/summary-sequencer';
import {
  Failure,
  Loading,
  Missing,
  useRemote,
  type Platform,
} from '../ui/shared';
import {
  FirstLoginEditor,
  needsFirstLogin,
  SocialEditor,
} from '../ui/editors';
import { LegacyProfileTopSection } from '../components/legacy/LegacyProfileHeader';
import {
  LegacyRelatedActivities,
  LegacySocialGrid,
  useRelatedActivitiesData,
} from '../components/legacy/LegacyProfileSocialAndRelated';
import { LegacyIdentityCard } from '../components/legacy/LegacyIdentityCard';
import { LegacyLineNotifyCard } from '../components/legacy/LegacyLineNotifyCard';
import { LegacyProfileInfoCard } from '../components/legacy/LegacyProfileCards';
import { LegacyFavoritesCard } from '../components/legacy/LegacyFavoritesCard';
import {
  LegacyApplicationsCard,
  useMyTeamApplications,
} from '../components/legacy/LegacyApplicationsCard';
import { LegacyCompanionsCard } from '../components/legacy/LegacyCompanionsCard';
import { LegacyActivityRecordsCard } from '../components/legacy/LegacyActivityRecordsCard';
import { ProfileQuickBar, type QuickItem } from '../components/legacy/ProfileQuickBar';
import { readLineNotify } from '../data/line-notify-settings';
// A 的個人頁活動卡沿用活動列表的 tl-event-* 樣式（A 全站載入 activity.css）。
import '@/features/events/legacy/activity.css';
import '../legacy/profile.css';

// M-128：移除 eduChildren；M-127：companions 改成就地展開的 LegacyCompanionsCard，
// 不再走 B 既有 PeopleEditor。
type Editor =
  | { kind: 'first' }
  | { kind: 'social'; platform: Platform }
  | null;

function LegacyLoginPrompt(): JSX.Element {
  // M-035：接上 App 的 LINE 登入流程（發送 auth:login-request，由 App 統一處理）
  const handleLoginClick = (): void => {
    emit('auth:login-request', {});
  };

  return (
    <div id="profile-login-prompt" class="profile-login-prompt">
      <div class="login-prompt-content">
        <div class="login-prompt-icon">👤</div>
        <h3 data-i18n="profilePage.notLoggedIn">
          {lt('profilePage.notLoggedIn', '尚未登入')}
        </h3>
        <p data-i18n="請先使用 LINE 帳號登入以查看個人資料">
          {lt('請先使用 LINE 帳號登入以查看個人資料', '請先使用 LINE 帳號登入以查看個人資料')}
        </p>
        {/* ASSUMPTION: 沿用 B 現有 LoginGuide 契約（不虛構全域 LineAuth API），保留 A 的按鈕結構與 SVG */}
        <button type="button" class="line-login-btn large" onClick={handleLoginClick}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
            <path d="M12 2C6.48 2 2 5.83 2 10.5c0 4.18 3.66 7.68 8.58 8.38.33.07.78.22.9.5.1.26.07.66.03.92l-.15.86c-.04.26-.2 1.01.88.55s5.88-3.47 8.03-5.93C22.08 13.79 22 12.18 22 10.5 22 5.83 17.52 2 12 2z" />
          </svg>
          LINE 登入
        </button>
      </div>
    </div>
  );
}

function ProfileContent({
  uid,
  initial,
  viewer,
}: {
  uid: string;
  initial: UserProfile;
  viewer: ViewerView;
}): JSX.Element {
  const [profile, setProfile] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);

  const t = useT();
  const firstOpen = !dismissed && needsFirstLogin(profile);
  const canEditIdentity = viewer.hasPermission('profile.secondary_identity');

  // 11-06 改版：徽章與「申請」是否顯示要在收合時就知道，資料由頁面讀一次、展開區共用（讀取次數同改版前）。
  const related = useRelatedActivitiesData(uid);
  const applications = useMyTeamApplications(uid, profile);
  const relatedCounts = related.state.status === 'ready' ? related.state.data : null;
  const lineBound = readLineNotify(profile).bound;

  // 頁首 summary 有兩個來源：掛載時的讀取、卡片刷新後交來的較新值。兩者共用卡片同一套發出序號保護，
  // 掛載讀取比刷新慢完成時，舊值不得蓋掉較新的頁首數字。
  const summarySeq = useSummarySequencer();

  useEffect(() => {
    let active = true;
    setSummary(null);
    const token = summarySeq.issue();
    loadUserAttendanceSummary(uid)
      .then((res) => {
        // 與卡片同一規則：讀取失敗（null）不推進已套用序號，也不覆蓋既有 summary（起始的清空由上面的 setSummary(null) 負責）。
        if (active && res !== null && summarySeq.accept(token)) setSummary(res);
      })
      .catch(() => { /* 讀取失敗維持 -- */ });
    return () => {
      active = false;
    };
  }, [uid, summarySeq]);

  // 卡片刷新成功後交來的 summary 一定比掛載時發出的讀取新：發新序號套用，之後晚到的舊讀取會被丟棄。
  function summaryRefreshed(next: UserAttendanceSummary): void {
    if (summarySeq.accept(summarySeq.issue())) setSummary(next);
  }

  function saved(patch: Record<string, unknown>): void {
    setProfile((previous) => ({ ...previous, ...patch }));
    setEditor(null);
    setDismissed(true);
  }

  function close(): void {
    setEditor(null);
  }

  const withCount = (name: string, n: number | null): string =>
    n === null ? name : t('profile.quick.count', { name, n });

  const quickItems: QuickItem[] = [
    {
      key: 'reg',
      icon: 'reg',
      label: t('profile.quick.reg'),
      ariaLabel: withCount(t('profile.quick.regName'), relatedCounts ? relatedCounts.registered.length : null),
      badge: relatedCounts?.registered.length ?? null,
      render: () => <LegacyRelatedActivities section="registered" data={related} />,
    },
    {
      key: 'info',
      icon: 'info',
      label: t('profile.quick.info'),
      ariaLabel: t('profile.quick.infoName'),
      render: () => <LegacyProfileInfoCard embedded uid={uid} profile={profile} onSaved={saved} />,
    },
    ...(canEditIdentity
      ? [{
          key: 'id2',
          icon: 'id2',
          label: t('profile.quick.id2'),
          ariaLabel: t('profile.quick.id2Name'),
          render: () => <LegacyIdentityCard embedded uid={uid} profile={profile} viewer={viewer} />,
        } satisfies QuickItem]
      : []),
    {
      key: 'line',
      icon: 'bell',
      label: t('profile.quick.line'),
      ariaLabel: t(lineBound ? 'profile.quick.bound' : 'profile.quick.unbound', {
        name: t('profile.quick.lineName'),
      }),
      dot: lineBound,
      render: () => (
        <LegacyLineNotifyCard
          embedded
          uid={uid}
          profile={profile}
          onSaved={(patch) => setProfile((p) => ({ ...p, ...patch }))}
        />
      ),
    },
    {
      key: 'host',
      icon: 'host',
      label: t('profile.quick.host'),
      ariaLabel: withCount(t('profile.quick.hostName'), relatedCounts ? relatedCounts.hosted.length : null),
      badge: relatedCounts?.hosted.length ?? null,
      render: () => <LegacyRelatedActivities section="hosted" data={related} />,
    },
    {
      key: 'mate',
      icon: 'mate',
      label: t('profile.quick.mate'),
      ariaLabel: t('profile.quick.mateName'),
      render: () => <LegacyCompanionsCard embedded uid={uid} profile={profile} onSaved={saved} />,
    },
    // 照 A `_showApplicationsCard`：有申請紀錄才顯示。
    ...(applications && applications.length > 0
      ? [{
          key: 'apply',
          icon: 'apply',
          label: t('profile.quick.apply'),
          ariaLabel: t('profile.quick.applyName'),
          render: () => (
            <LegacyApplicationsCard embedded uid={uid} profile={profile} items={applications} />
          ),
        } satisfies QuickItem]
      : []),
  ];

  return (
    <div id="profile-content">
      <LegacyProfileTopSection
        uid={uid}
        profile={profile}
        viewer={viewer}
        summary={summary}
      />

      <LegacySocialGrid
        profile={profile}
        onEdit={(platform) => setEditor({ kind: 'social', platform })}
      />

      <ProfileQuickBar items={quickItems} groupLabel={t('profile.quick.group')} />

      {SHOW_FAVORITES && (
        <LegacyFavoritesCard uid={uid} profile={profile} />
      )}
      <LegacyActivityRecordsCard uid={uid} onSummaryRefreshed={summaryRefreshed} />

      {(firstOpen || editor?.kind === 'first') && (
        <FirstLoginEditor
          uid={uid}
          profile={profile}
          onSaved={saved}
          onClose={() => {
            setDismissed(true);
            close();
          }}
        />
      )}
      {!firstOpen && editor?.kind === 'social' && (
        <SocialEditor
          key={editor.platform}
          uid={uid}
          profile={profile}
          platform={editor.platform}
          onClose={close}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function AuthenticatedProfile({
  uid,
  viewer,
}: {
  uid: string;
  viewer: ViewerView;
}): JSX.Element {
  const { state, retry } = useRemote(uid, loadUserProfile);
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Failure retry={retry} />;
  // 查無個人資料：單一區塊＝「找不到資料」＋重試。loadUserProfile 會吞掉 I/O 錯誤回 null，
  // null 也可能是網路暫時失敗，所以必須有重試；不同時顯示「目前無法載入」那塊（退修 1 #6、退修 2 P2-1）。
  if (!state.data) return <Missing retry={retry} />;

  return <ProfileContent uid={uid} initial={state.data} viewer={viewer} />;
}

export default function ProfilePage(): JSX.Element {
  const viewer = useViewer();
  const goBack = useGoBack('/');

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-profile">
        <div class="page-header profile-page-nav-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={goBack}
          >
            <svg
              class="back-btn-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <h2 class="page-header-title" data-i18n="profile.myProfile">
            {lt('profile.myProfile', '我的資料')}
          </h2>
        </div>

        {viewer.uid ? (
          <AuthenticatedProfile key={viewer.uid} uid={viewer.uid} viewer={viewer} />
        ) : (
          <LegacyLoginPrompt />
        )}
      </section>
    </div>
  );
}
