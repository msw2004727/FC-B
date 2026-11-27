import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { emit, on } from '@/core/events';
import { useGoBack } from '@/core/back-guard';
import { SHOW_FAVORITES } from '@/core/hidden-features';
import { lt, useT } from '@/i18n/i18n';
import { GuestAvatarIcon } from '@/ui/GuestAvatarIcon';
import { useViewer, type ViewerView } from '../data/viewer';
import {
  loadOwnUserProfile,
  loadOwnUserProfileFromCache,
  type UserProfile,
} from '../data/profile-model';
import {
  loadUserAttendanceSummary,
  type UserAttendanceSummary,
} from '../data/attendance-summary';
import { useSummarySequencer } from '../data/summary-sequencer';
import {
  Failure,
  Loading,
  Missing,
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
  type RelatedActivitiesData,
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
import { focusPushRow, hasPushFocus } from '../components/legacy/push-focus';
import { readLineNotify } from '../data/line-notify-settings';
// A 的個人頁活動卡沿用活動列表的 tl-event-* 樣式（A 全站載入 activity.css）。
import '@/features/events/legacy/activity.css';
import '../legacy/profile.css';
// 2026-11-16 站長選定液態玻璃（PROFILE-GLASS），寫在 A 的 profile.css 之後。
import '../legacy/profile-glass.css';

const SportPrefsGate = lazy(() => import('@/features/sport-prefs/SportPrefsGate').then((m) => ({ default: m.SportPrefsGate })).catch(() => ({ default: () => null })));

// M-128：移除 eduChildren；M-127：companions 改成就地展開的 LegacyCompanionsCard，
// 不再走 B 既有 PeopleEditor。
type Editor =
  | { kind: 'first' }
  | { kind: 'social'; platform: Platform }
  | null;

const LINE_ICON_PATH =
  'M12 2C6.48 2 2 5.83 2 10.5c0 4.18 3.66 7.68 8.58 8.38.33.07.78.22.9.5.1.26.07.66.03.92l-.15.86c-.04.26-.2 1.01.88.55s5.88-3.47 8.03-5.93C22.08 13.79 22 12.18 22 10.5 22 5.83 17.52 2 12 2z';

function LineLoginButton(): JSX.Element {
  // M-035：接上 App 的 LINE 登入流程（發送 auth:login-request，由 App 統一處理）
  const handleLoginClick = (): void => {
    emit('auth:login-request', {});
  };
  return (
    <button type="button" class="line-login-btn large" onClick={handleLoginClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true" focusable="false">
        <path d={LINE_ICON_PATH} />
      </svg>
      LINE 登入
    </button>
  );
}

/**
 * 未登入畫面（站長 11-12 選定版本 A、不放說明句）：人形 SVG（取代 👤 emoji）、標題、LINE 登入按鈕整塊置中。
 * 取代了開發環境限定的卡片式 B 版預覽，以及 A 在標題下的登入說明句（舊版翻譯包同步刪除該鍵）。
 */
function GuestLoginPrompt(): JSX.Element {
  return (
    <div id="profile-login-prompt" class="profile-login-prompt">
      <div class="login-prompt-content">
        <div class="login-prompt-icon">
          <GuestAvatarIcon size={56} />
        </div>
        <h3 data-i18n="profilePage.notLoggedIn">
          {lt('profilePage.notLoggedIn', '尚未登入')}
        </h3>
        <LineLoginButton />
      </div>
    </div>
  );
}

type OwnProfileState =
  | { status: 'loading' }
  | { status: 'cached'; data: UserProfile }
  | { status: 'cached-error'; data: UserProfile }
  | { status: 'ready'; data: UserProfile | null }
  | { status: 'error' };

/**
 * PROFILE-SPEED F2：「我的」頁的個人資料快取先畫、伺服器後到換新。
 * - 掛載（及每次 retry）都會發伺服器；只有 attempt 0 同時讀快取。
 * - 快取只在「這個 effect 仍有效、伺服器還沒有結果、快取回非 null」時套用。
 * - 伺服器成功 → ready（data 可能為 null）；失敗 → 目前有資料就 cached-error 保留同一份，否則 error。
 */
function useOwnProfileCacheFirst(uid: string): { state: OwnProfileState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OwnProfileState>({ status: 'loading' });

  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    // 伺服器是否已有結果（成功或失敗）：晚到的快取一律丟棄。
    let serverDone = false;

    Promise.resolve()
      .then(() => loadOwnUserProfile(uid))
      .then((data) => {
        if (!active) return;
        serverDone = true;
        setState({ status: 'ready', data });
      })
      .catch(() => {
        if (!active) return;
        serverDone = true;
        setState((current) => {
          if (current.status === 'cached' || current.status === 'cached-error') {
            return { status: 'cached-error', data: current.data };
          }
          if (current.status === 'ready' && current.data) {
            return { status: 'cached-error', data: current.data };
          }
          return { status: 'error' };
        });
      });

    if (attempt === 0) {
      // PROFILE-SPEED：既有測試以 vi.mock 工廠 mock 這個模組而未提供快取函式；存取不存在的 export 會丟錯，包成「丟錯＝快取沒有」。
      Promise.resolve()
        .then(() => loadOwnUserProfileFromCache(uid))
        .catch(() => null)
        .then((cached) => {
          if (!active || serverDone || cached === null) return;
          setState((current) => (current.status === 'loading' ? { status: 'cached', data: cached } : current));
        });
    }

    return () => {
      active = false;
    };
  }, [uid, attempt]);

  const retry = useCallback(() => {
    // PROFILE-SPEED：cached-error 先設回 cached（畫面不閃），再重讀伺服器；error／ready(null) 設回 loading 維持轉圈重試。
    setState((current) => {
      if (current.status === 'cached-error') return { status: 'cached', data: current.data };
      if (current.status === 'error') return { status: 'loading' };
      if (current.status === 'ready' && !current.data) return { status: 'loading' };
      return current;
    });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

function ProfileContent({
  uid,
  initial,
  viewer,
  related,
  summaryTask,
  fresh,
  serverProfile,
}: {
  uid: string;
  initial: UserProfile;
  viewer: ViewerView;
  related: RelatedActivitiesData;
  summaryTask: Promise<UserAttendanceSummary | null>;
  fresh: boolean;
  serverProfile: UserProfile | null;
}): JSX.Element {
  const [profile, setProfile] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const [afterFirst, setAfterFirst] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [pendingEditor, setPendingEditor] = useState<Editor>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);

  const t = useT();
  // PROFILE-SPEED：首次登入提示要用伺服器值決定，不得用快取資料決定要不要跳。
  const firstOpen = fresh && !dismissed && needsFirstLogin(profile);
  const canEditIdentity = viewer.hasPermission('profile.secondary_identity');

  // PROFILE-SPEED：伺服器值到了才換新；下面閘門讓伺服器值到之前不可能有本地編輯，不會覆蓋使用者改的內容。
  useEffect(() => {
    if (serverProfile) setProfile(serverProfile);
  }, [serverProfile]);

  // PROFILE-SPEED：伺服器值到之前按下的編輯先記著，fresh 後才真的打開（失敗一直不 fresh 就一直不開）。
  useEffect(() => {
    if (fresh && pendingEditor) {
      setEditor(pendingEditor);
      setPendingEditor(null);
    }
  }, [fresh, pendingEditor]);

  // 11-06 改版：徽章與「申請」是否顯示要在收合時就知道，資料由頁面讀一次、展開區共用（讀取次數同改版前）。
  // related 由外層與個人資料同時開始讀（顧問 §3.233 ③甲）。
  // PROFILE-SPEED：伺服器值到才讀申請，避免 profile 換新造成重讀一次收件匣。
  const applications = useMyTeamApplications(uid, profile, fresh);
  const relatedLoading = related.state.status === 'loading';
  const relatedCounts = related.state.status === 'ready' ? related.state.data : null;
  const lineBound = readLineNotify(profile).bound;
  // 九宮格「開啟通知」帶 focus=push：捲到「手機／電腦通知」列（2026-11-27）。
  const pushFocus = hasPushFocus(location.search);
  // PROFILE-SPEED：伺服器值到才捲動；快取階段先不動作。
  useEffect(() => (pushFocus && fresh ? focusPushRow() : undefined), [pushFocus, fresh]);

  // 頁首 summary 有兩個來源：掛載時的讀取、卡片刷新後交來的較新值。兩者共用卡片同一套發出序號保護，
  // 掛載讀取比刷新慢完成時，舊值不得蓋掉較新的頁首數字。
  const summarySeq = useSummarySequencer();

  useEffect(() => {
    let active = true;
    setSummary(null);
    const token = summarySeq.issue();
    // 外層與個人資料同時發出的那一次讀取（不再等個人資料回來才讀；讀取次數不變）。
    // 那一次失敗（回 null，例如開頁時離線）才在這裡補讀一次，免得重試成功後頁首永遠停在 --（MiMo P1）。
    summaryTask
      .then((early) => (early !== null ? early : loadUserAttendanceSummary(uid)))
      .then((res) => {
        // 與卡片同一規則：讀取失敗（null）不推進已套用序號，也不覆蓋既有 summary（起始的清空由上面的 setSummary(null) 負責）。
        if (active && res !== null && summarySeq.accept(token)) setSummary(res);
      })
      .catch(() => { /* 讀取失敗維持 -- */ });
    return () => {
      active = false;
    };
  }, [uid, summarySeq, summaryTask]);

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

  // 讀取中接在名稱後面。快捷列沒有現成句子，句式比照 profile.quick.count，文案在 7 語系的 profile.quick.loading。
  const withCount = (name: string, n: number | null, loading = false): string => {
    if (loading) return t('profile.quick.loading', { name });
    return n === null ? name : t('profile.quick.count', { name, n });
  };

  const quickItems: QuickItem[] = [
    {
      key: 'reg',
      icon: 'reg',
      label: t('profile.quick.reg'),
      ariaLabel: withCount(
        t('profile.quick.regName'),
        relatedCounts ? relatedCounts.registered.length : null,
        relatedLoading,
      ),
      badge: relatedLoading ? null : (relatedCounts?.registered.length ?? null),
      loading: relatedLoading,
      render: (active) => <LegacyRelatedActivities section="registered" data={related} active={active} />,
    },
    {
      key: 'info',
      icon: 'info',
      label: t('profile.quick.info'),
      ariaLabel: t('profile.quick.infoName'),
      // PROFILE-SPEED：伺服器值到之前按了先記住，不展開；fresh 後自動展開。
      deferred: !fresh,
      render: () => <LegacyProfileInfoCard embedded uid={uid} profile={profile} onSaved={saved} />,
    },
    ...(canEditIdentity
      ? [{
          key: 'id2',
          icon: 'id2',
          label: t('profile.quick.id2'),
          ariaLabel: t('profile.quick.id2Name'),
          deferred: !fresh,
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
      deferred: !fresh,
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
      ariaLabel: withCount(
        t('profile.quick.hostName'),
        relatedCounts ? relatedCounts.hosted.length : null,
        relatedLoading,
      ),
      badge: relatedLoading ? null : (relatedCounts?.hosted.length ?? null),
      loading: relatedLoading,
      render: (active) => <LegacyRelatedActivities section="hosted" data={related} active={active} />,
    },
    {
      key: 'mate',
      icon: 'mate',
      label: t('profile.quick.mate'),
      ariaLabel: t('profile.quick.mateName'),
      deferred: !fresh,
      render: () => <LegacyCompanionsCard embedded uid={uid} profile={profile} onSaved={saved} />,
    },
    // 照 A `_showApplicationsCard`：有申請才留。讀取中（null）不畫鈕：多數使用者沒有申請，
    // 讀取中先畫、讀完才拿掉會讓置中的快捷列整排左右位移一次（Opus 交叉審 P2-1，站長「不造成版面位移」原則）。
    ...((applications?.length ?? 0) > 0
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
        onEdit={(platform) => {
          // PROFILE-SPEED：伺服器值到之前先記住，fresh 後才真的打開。
          if (fresh) {
            setEditor({ kind: 'social', platform });
          } else {
            setPendingEditor({ kind: 'social', platform });
          }
        }}
      />

      <ProfileQuickBar
        items={quickItems}
        groupLabel={t('profile.quick.group')}
        initialOpenKey={fresh ? new URLSearchParams(location.search).get('open') : null}
      />

      {SHOW_FAVORITES && (
        <LegacyFavoritesCard uid={uid} profile={profile} />
      )}
      <LegacyActivityRecordsCard uid={uid} summaryTask={summaryTask} onSummaryRefreshed={summaryRefreshed} />

      {(firstOpen || editor?.kind === 'first') && (
        <FirstLoginEditor
          uid={uid}
          profile={profile}
          onSaved={(patch) => { saved(patch); setAfterFirst(true); }}
          onClose={() => {
            setDismissed(true);
            close();
          }}
        />
      )}
      {afterFirst && !profile['favSportsPromptAt'] && (
        <Suspense fallback={null}>
          <SportPrefsGate
            uid={uid}
            owned={Array.isArray(profile['favSports']) ? (profile['favSports'] as string[]) : []}
            onSaved={(r) => setProfile((previous) => ({ ...previous, favSports: r.favSports, newEventNotify: r.newEventNotify }))}
          />
        </Suspense>
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
  const { state, retry } = useOwnProfileCacheFirst(uid);
  // PROFILE-SPEED：個人資料曾進入 cached 才允許相關活動讀快取（私密文件開過本頁才會有快取，第一次開避免先顯示錯的 0）。
  const cacheHitRef = useRef(false);
  if (state.status === 'cached') cacheHitRef.current = true;
  // 顧問 §3.233 ③甲：出席統計與相關活動只需要 uid，和個人資料同時開始讀。
  // 顧問 §3.930（站長選「先顯示上次資料」）取代 §3.233「不顯示舊資料」：個人資料與相關活動先畫本機快取再換伺服器值。
  // 統計失敗只影響數字（回 null 顯示 --）；個人資料沒有快取時失敗仍是整頁失敗＋重試，有快取時保留畫面＋既有重試提示、不可編輯。
  const related = useRelatedActivitiesData(uid, cacheHitRef.current);
  const [summaryTask] = useState(() => loadUserAttendanceSummary(uid).catch(() => null));
  // 剛登入時會員文件可能還在建立（data/user-doc-sync.ts 完成後發 viewer:refresh）：查無資料時收到就重讀一次。
  const missing = state.status === 'ready' && !state.data;
  useEffect(() => (missing ? on('viewer:refresh', () => retry()) : undefined), [missing]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Failure retry={retry} />;
  // 查無個人資料：單一區塊＝「找不到資料」＋重試。loadUserProfile 會吞掉 I/O 錯誤回 null，
  // null 也可能是網路暫時失敗，所以必須有重試；不同時顯示「目前無法載入」那塊（退修 1 #6、退修 2 P2-1）。
  if (state.status === 'ready' && !state.data) return <Missing retry={retry} />;

  const fresh = state.status === 'ready';
  // PROFILE-SPEED：cached／cached-error／ready 共用同一棵樹（ProfileContent 固定在第二個位置），狀態切換時不重掛、不重讀。
  // cached-error 沿用既有 Failure 重試提示（不加新樣式／文字）。
  return (
    <>
      {state.status === 'cached-error' && <Failure retry={retry} />}
      <ProfileContent
        uid={uid}
        initial={state.data as UserProfile}
        viewer={viewer}
        related={related}
        summaryTask={summaryTask}
        fresh={fresh}
        serverProfile={fresh ? state.data : null}
      />
    </>
  );
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

        {/* L-43：登入狀態還沒判定（authPending）先顯示載入中，確定未登入才顯示登入畫面，重新整理不再閃「尚未登入」。 */}
        {viewer.uid ? (
          <AuthenticatedProfile key={viewer.uid} uid={viewer.uid} viewer={viewer} />
        ) : viewer.authPending ? (
          <Loading />
        ) : (
          <GuestLoginPrompt />
        )}
      </section>
    </div>
  );
}
