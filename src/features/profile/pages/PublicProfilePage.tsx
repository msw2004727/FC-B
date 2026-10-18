import { useT } from '@/i18n/i18n';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { loadUserProfile, type UserProfile } from '../data/profile-model';
import {
  Clubs,
  Failure,
  Loading,
  Missing,
  Page,
  ProfileHeader,
  SocialLinks,
  objectValue,
  stringValue,
  useRemote,
} from '../ui/shared';
import QrPage from './QrPage';

export function publicProjection(profile: UserProfile): UserProfile | null {
  // ASSUMPTION: 附件沒有有效公開權限／第二身分公開投影 API。
  // 遇明確私密或第二身分資料一律不渲染，不能以 blur 隱藏已放入 DOM 的私密資訊。
  if (
    profile['isPrivate'] === true ||
    profile['profileVisibility'] === 'private' ||
    profile['secondaryEnabled'] === true ||
    profile['secondaryIdentityEnabled'] === true ||
    objectValue(profile['secondaryIdentity'])['enabled'] === true
  ) return null;

  // ASSUMPTION: 一般名片的公開白名單為名稱、頭像、角色、俱樂部名稱、社群。
  // 不傳遞生日、地區、email、電話、同行者、子女、活動或其他讀模型欄位。
  return {
    uid: profile.uid,
    name: profile.name,
    _docId: profile._docId,
    lastActive: null,
    pictureUrl: stringValue(profile['pictureUrl']),
    role: profile['role'],
    teamName: profile['teamName'],
    teamNames: profile['teamNames'],
    socialLinks: profile['socialLinks'],
  };
}

function PublicCard({ uid }: { uid: string }) {
  const t = useT();
  const { state, retry } = useRemote(uid, loadUserProfile);
  if (!uid) return <Missing />;
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Failure retry={retry} />;
  if (!state.data) return <><Missing /><Failure retry={retry} /></>;
  const profile = publicProjection(state.data);
  if (!profile) return <Missing />;

  return (
    <div class="profile-public">
      <ProfileHeader profile={profile} />
      <SocialLinks profile={profile} />
      <Card>
        <Clubs profile={profile} />
        <p class="profile-note"><Text>{t('profile.publicOnly')}</Text></p>
      </Card>
    </div>
  );
}

export default function PublicProfilePage({ uid = '' }: { uid?: string }) {
  const t = useT();
  // preact-iso 的參數直接傳入頁面；第二層保護避免保留字進入使用者資料查詢。
  if (uid === 'qr') return <QrPage />;
  return (
    <Page back title={t('profile.publicTitle')}>
      <PublicCard key={uid} uid={uid} />
    </Page>
  );
}
