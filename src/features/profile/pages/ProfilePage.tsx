import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { useViewer, type ViewerView } from '../data/viewer';
import { loadUserProfile, type UserProfile } from '../data/profile-model';
import {
  loadUserAttendanceSummary,
  type UserAttendanceSummary,
} from '../data/attendance-summary';
import {
  Failure,
  Loading,
  Missing,
  useRemote,
  type Platform,
} from '../ui/shared';
import {
  FirstLoginEditor,
  IdentityEditor,
  needsFirstLogin,
  PeopleEditor,
  SocialEditor,
} from '../ui/editors';
import { LegacyProfileTopSection } from '../components/legacy/LegacyProfileHeader';
import {
  LegacyRelatedActivities,
  LegacySocialGrid,
} from '../components/legacy/LegacyProfileSocialAndRelated';
import {
  LegacyIdentityCard,
  LegacyProfileInfoCard,
} from '../components/legacy/LegacyProfileCards';
import { UNAVAILABLE_MSG } from '../components/legacy/profile-legacy-helpers';
// A 的個人頁活動卡沿用活動列表的 tl-event-* 樣式（A 全站載入 activity.css）。
import '@/features/events/legacy/activity.css';
import '@/styles/legacy/edu-info-btn.css';
import '../legacy/profile.css';

type Editor =
  | { kind: 'companions' | 'eduChildren' | 'identity' | 'first' }
  | { kind: 'social'; platform: Platform }
  | null;

function LegacyLoginPrompt(): JSX.Element {
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
        <button type="button" class="line-login-btn large">
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
  const t = useT();
  const [profile, setProfile] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);

  const firstOpen = !dismissed && needsFirstLogin(profile);
  const canEditIdentity = viewer.hasPermission('profile.secondary_identity');

  useEffect(() => {
    let active = true;
    setSummary(null);
    loadUserAttendanceSummary(uid)
      .then((res) => {
        if (active) setSummary(res);
      })
      .catch(() => {
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
  }, [uid]);

  function saved(patch: Record<string, unknown>): void {
    setProfile((previous) => ({ ...previous, ...patch }));
    setEditor(null);
    setDismissed(true);
  }

  function close(): void {
    setEditor(null);
  }

  const companionsCount = Array.isArray(profile['companions'])
    ? profile['companions'].length
    : 0;
  const childrenCount = Array.isArray(profile['eduChildren'])
    ? profile['eduChildren'].length
    : 0;

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

      <LegacyRelatedActivities uid={uid} />

      {canEditIdentity && (
        <LegacyIdentityCard
          profile={profile}
          onOpenEditor={() => setEditor({ kind: 'identity' })}
        />
      )}

      <LegacyProfileInfoCard uid={uid} profile={profile} onSaved={saved} />

      {/* 下一批補：LINE 推播通知綁定（#profile-line-notify） */}
      {/* 下一批補：我的收藏（#profile-favorites-card） */}
      {/* 下一批補：我的俱樂部申請（#profile-applications-card） */}

      {/* 我的運動夥伴（同行者入口，點擊開 B 既有 PeopleEditor） */}
      <div class="info-card" id="my-companions-card">
        <div
          class="info-title profile-collapse-toggle"
          role="button"
          tabIndex={0}
          aria-label={t('profile.companions')}
          onClick={() => setEditor({ kind: 'companions' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setEditor({ kind: 'companions' });
            }
          }}
        >
          <span style="display:flex;align-items:center;gap:.35rem">
            <span
              class="edu-info-btn"
              title={lt('說明', '說明')}
              data-i18n-title="說明"
              onClick={(e) => {
                e.stopPropagation();
                toast.show({ message: UNAVAILABLE_MSG });
              }}
            >
              ?
            </span>
            <span data-i18n="我的運動夥伴">{lt('我的運動夥伴', '我的運動夥伴')}</span>
            <span class="fav-count-badge" id="companions-count">
              {String(companionsCount)}
            </span>
          </span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
      </div>

      {/* 教育子女入口（保留 B 既有功能，外觀採 A info-card 標題列結構，點擊開 PeopleEditor） */}
      <div class="info-card" id="my-edu-children-card">
        <div
          class="info-title profile-collapse-toggle"
          role="button"
          tabIndex={0}
          aria-label={t('profile.children')}
          onClick={() => setEditor({ kind: 'eduChildren' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setEditor({ kind: 'eduChildren' });
            }
          }}
        >
          <span style="display:flex;align-items:center;gap:.35rem">
            <span>{t('profile.children')}</span>
            <span class="fav-count-badge" id="edu-children-count">
              {String(childrenCount)}
            </span>
          </span>
          <span class="profile-collapse-arrow">▶</span>
        </div>
      </div>

      {/* 下一批補：報名紀錄分頁（#record-tabs / #my-activity-records） */}

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
      {!firstOpen &&
        (editor?.kind === 'companions' || editor?.kind === 'eduChildren') && (
          <PeopleEditor
            key={editor.kind}
            uid={uid}
            profile={profile}
            kind={editor.kind}
            onClose={close}
            onSaved={saved}
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
      {!firstOpen && editor?.kind === 'identity' && canEditIdentity && (
        <IdentityEditor profile={profile} onClose={close} onSaved={saved} />
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
  if (!state.data) {
    return (
      <>
        <Missing />
        <Failure retry={retry} />
      </>
    );
  }

  return <ProfileContent uid={uid} initial={state.data} viewer={viewer} />;
}

export default function ProfilePage(): JSX.Element {
  const viewer = useViewer();
  const location = useLocation();

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-profile">
        <div class="page-header profile-page-nav-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={() => location.route('/')}
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
