import { useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { useViewer, type ViewerView } from '../data/viewer';
import { loadUserProfile, type UserProfile } from '../data/profile-model';
import { loadRelatedActivities, type EventRecord } from '../data/related-activities';
import {
  Clubs,
  Failure,
  Loading,
  LoginGuide,
  Missing,
  Page,
  ProfileHeader,
  SocialLinks,
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

type Editor =
  | { kind: 'companions' | 'eduChildren' | 'identity' | 'first' }
  | { kind: 'social'; platform: Platform }
  | null;

function ActivityRows({ events }: { events: readonly EventRecord[] }) {
  const t = useT();
  const valid = events.filter((event) => typeof event.id === 'string' && event.id.length > 0);
  return valid.length ? (
    <ul class="profile-activity-list">
      {valid.map((event) => (
        <li key={event.id}>
          <a href={`/events/${encodeURIComponent(event.id ?? '')}`}>
            <Text>{event.title || t('profile.untitledEvent')}</Text>
          </a>
        </li>
      ))}
    </ul>
  ) : <p class="profile-empty"><Text>{t('profile.noActivities')}</Text></p>;
}

function RelatedActivities({ uid }: { uid: string }) {
  const t = useT();
  const { state, retry } = useRemote(uid, loadRelatedActivities);
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Failure retry={retry} />;

  // 附件 loadRelatedActivities 排除 ended/cancelled，無已參加歷史。
  // 不假裝空陣列代表「從未參加」，不在 UI 自行補查 Firestore。
  return (
    <>
      <Card>
        <details open>
          <summary>
            <Text>{t('profile.registered')}</Text>
            <Text class="profile-count">{String(state.data.registered.length)}</Text>
          </summary>
          <ActivityRows events={state.data.registered.map((item) => item.event)} />
          <p class="profile-note"><Text>{t('profile.historyUnavailable')}</Text></p>
        </details>
      </Card>
      <Card>
        <details open>
          <summary>
            <Text>{t('profile.hosted')}</Text>
            <Text class="profile-count">{String(state.data.hosted.length)}</Text>
          </summary>
          <ActivityRows events={state.data.hosted.map((item) => item.event)} />
        </details>
      </Card>
    </>
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
}) {
  const t = useT();
  const [profile, setProfile] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const firstOpen = !dismissed && needsFirstLogin(profile);
  const canEditIdentity = viewer.hasPermission('profile.secondary_identity');

  function saved(patch: Record<string, unknown>): void {
    setProfile((previous) => ({ ...previous, ...patch }));
    setEditor(null);
    setDismissed(true);
  }

  function close(): void {
    setEditor(null);
  }

  return (
    <div class="profile-content">
      <ProfileHeader profile={profile} />
      <div class="profile-qr-entry">
        <a href="/profile/qr"><Text>{t('profile.qr')}</Text></a>
      </div>
      <SocialLinks profile={profile} onEdit={(platform) => setEditor({ kind: 'social', platform })} />
      <RelatedActivities uid={uid} />

      {canEditIdentity && (
        <Card>
          <button type="button" class="profile-entry" onClick={() => setEditor({ kind: 'identity' })}>
            <Text>{t('profile.identity')}</Text>
            <span aria-hidden="true">›</span>
          </button>
        </Card>
      )}

      <Card>
        <details>
          <summary><Text>{t('profile.title')}</Text></summary>
          <Clubs profile={profile} />
          <button type="button" onClick={() => setEditor({ kind: 'first' })}>
            <Text>{t('profile.editProfile')}</Text>
          </button>
        </details>
      </Card>

      <Card>
        <button type="button" class="profile-entry" onClick={() => setEditor({ kind: 'companions' })}>
          <Text>{t('profile.companions')}</Text>
          <span aria-hidden="true">›</span>
        </button>
      </Card>
      <Card>
        {/* 子女由教育課程審核自動綁定；此入口僅提供列表與解除綁定。 */}
        <button type="button" class="profile-entry" onClick={() => setEditor({ kind: 'eduChildren' })}>
          <Text>{t('profile.children')}</Text>
          <span aria-hidden="true">›</span>
        </button>
      </Card>

      {(firstOpen || editor?.kind === 'first') && (
        <FirstLoginEditor
          uid={uid}
          profile={profile}
          onSaved={saved}
          onClose={() => { setDismissed(true); close(); }}
        />
      )}
      {!firstOpen && (editor?.kind === 'companions' || editor?.kind === 'eduChildren') && (
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

function AuthenticatedProfile({ uid, viewer }: { uid: string; viewer: ViewerView }) {
  const { state, retry } = useRemote(uid, loadUserProfile);
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Failure retry={retry} />;
  // loadUserProfile 會吞掉部分 I/O 錯誤並回 null，因此 null 也提供重試。
  if (!state.data) return <><Missing /><Failure retry={retry} /></>;

  return <ProfileContent uid={uid} initial={state.data} viewer={viewer} />;
}

export default function ProfilePage() {
  const t = useT();
  const viewer = useViewer();
  return (
    <Page title={t('profile.title')}>
      {viewer.uid
        ? <AuthenticatedProfile key={viewer.uid} uid={viewer.uid} viewer={viewer} />
        : <LoginGuide />}
    </Page>
  );
}
