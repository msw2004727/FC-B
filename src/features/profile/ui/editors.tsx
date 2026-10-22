// 個人頁編輯入口（T-019 第 2 段起改為照 A 的 legacy modal；ProfilePage 與建立活動入口仍由這裡載入）。
// M-123 IdentityEditor、M-127 PeopleEditor 已移除（改由 LegacyIdentityCard、LegacyCompanionsCard 行內編輯）；
// M-128 子女卡移除；M-130 首次登入與社群連結改用 LegacyFirstLoginModal／LegacySocialLinkModal。
import type { UserProfile } from '../data/profile-model';
import { objectValue, stringValue, type Platform } from './shared';
import { LegacyFirstLoginModal } from '../components/legacy/LegacyFirstLoginModal';
import { LegacySocialLinkModal } from '../components/legacy/LegacySocialLinkModal';

type Saved = (patch: Record<string, unknown>) => void;

export function needsFirstLogin(profile: UserProfile): boolean {
  return ['gender', 'birthday', 'region'].some((key) => !stringValue(profile[key]));
}

export function FirstLoginEditor({
  uid,
  profile,
  onClose,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  onClose: () => void;
  onSaved: Saved;
}) {
  // M-130：照 A #first-login-modal（profile-complete-modal），寫入仍走 saveFirstLoginProfile。
  return (
    <LegacyFirstLoginModal
      uid={uid}
      initial={{
        gender: stringValue(profile['gender']),
        birthday: stringValue(profile['birthday']),
        region: stringValue(profile['region']),
        email: stringValue(profile['email']),
      }}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

export function SocialEditor({
  uid,
  profile,
  platform,
  onClose,
  onSaved,
}: {
  uid: string;
  profile: UserProfile;
  platform: Platform;
  onClose: () => void;
  onSaved: Saved;
}) {
  // M-130：照 A #social-link-modal（網址前綴列），寫入仍走 saveSocialLink／clearSocialLink。
  return (
    <LegacySocialLinkModal
      uid={uid}
      platform={platform}
      socialLinks={objectValue(profile['socialLinks'])}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
