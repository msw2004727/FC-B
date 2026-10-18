import type { ComponentChildren, ComponentProps } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';

// ASSUMPTION: 元件索引未附匯入路徑；沿用 PlaceholderPage 的 @/ui/<元件名> 配置。
import { Avatar } from '@/ui/Avatar';
import { Text } from '@/ui/Text';
import { UserTag } from '@/ui/UserTag';

import type { UserProfile } from '../data/profile-model';
import { normalizeLineContactUrl } from '../data/profile-writes';
import './profile.css';

export type Translate = ReturnType<typeof useT>;

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T };

interface Snapshot<T> {
  identity: string;
  attempt: number;
  state: Remote<T>;
}

export function useRemote<T>(
  identity: string,
  loader: (identity: string) => Promise<T>,
): { state: Remote<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);

  useEffect(() => {
    let active = true;
    if (!identity) return;

    Promise.resolve()
      .then(() => loader(identity))
      .then((data) => {
        if (active) {
          setSnapshot({ identity, attempt, state: { status: 'ready', data } });
        }
      })
      .catch(() => {
        if (active) {
          setSnapshot({ identity, attempt, state: { status: 'error' } });
        }
      });

    return () => { active = false; };
  }, [identity, attempt, loader]);

  // UID 在 render 即隔離；不等 effect 才清掉上一個帳號的資料。
  const state: Remote<T> =
    snapshot?.identity === identity && snapshot.attempt === attempt
      ? snapshot.state
      : { status: 'loading' };

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export function Page({
  title,
  back = false,
  children,
}: {
  title: string;
  /** 子頁（QR、他人名片）才顯示「返回個人頁」；個人頁本身不顯示。 */
  back?: boolean;
  children: ComponentChildren;
}) {
  const t = useT();
  return (
    <section class="profile-page">
      <header class="profile-page-nav">
        {back && (
          <a class="profile-back" href="/profile">
            <Text>{t('profile.back')}</Text>
          </a>
        )}
        <h1><Text>{title}</Text></h1>
      </header>
      {children}
    </section>
  );
}

export function LoginGuide() {
  const t = useT();
  // ASSUMPTION: 附件沒有登入函式契約；使用既有全域 LINE 登入入口，不虛構登入 API。
  return (
    <div class="profile-state">
      <span aria-hidden="true">👤</span>
      <h2><Text>{t('profile.guest')}</Text></h2>
      <Text>{t('profile.loginGuide')}</Text>
    </div>
  );
}

export function Loading() {
  const t = useT();
  return <div class="profile-state" role="status"><Text>{t('profile.loading')}</Text></div>;
}

export function Failure({ retry }: { retry: () => void }) {
  const t = useT();
  return (
    <div class="profile-state">
      <p role="alert"><Text>{t('profile.loadError')}</Text></p>
      <button type="button" onClick={retry}><Text>{t('profile.retry')}</Text></button>
    </div>
  );
}

export function Missing() {
  const t = useT();
  return <div class="profile-state"><Text>{t('profile.unavailable')}</Text></div>;
}

type Role = NonNullable<ComponentProps<typeof UserTag>['role']>;

function profileRole(value: unknown): Role {
  // ASSUMPTION: UserRole 採 A 的七個內建角色；未知／自訂角色降級為 user。
  switch (value) {
    case 'coach':
    case 'captain':
    case 'team_leader':
    case 'venue_owner':
    case 'admin':
    case 'super_admin':
      return value as Role;
    default:
      return 'user' as Role;
  }
}

export const PLATFORMS = ['fb', 'ig', 'threads', 'yt', 'twitter', 'line'] as const;
export type Platform = typeof PLATFORMS[number];

const SOCIAL_BASE: Record<Exclude<Platform, 'line'>, string> = {
  fb: 'https://www.facebook.com/',
  ig: 'https://www.instagram.com/',
  threads: 'https://www.threads.net/@',
  yt: 'https://www.youtube.com/@',
  twitter: 'https://x.com/',
};

export function socialHref(platform: Platform, value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;

  let candidate: string;
  if (platform === 'line') {
    candidate = normalizeLineContactUrl(raw);
  } else if (/^https?:\/\//i.test(raw)) {
    candidate = raw;
  } else {
    // 禁止把 javascript:、data:、協定相對網址當成帳號處理。
    if (/[:/?#\\\s]/u.test(raw)) return null;
    candidate = `${SOCIAL_BASE[platform]}${encodeURIComponent(raw.replace(/^@/, ''))}`;
  }

  try {
    const url = new URL(candidate);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    if (platform === 'line' && url.protocol === 'line:') return url.href;
  } catch {
    return null;
  }
  return null;
}

export function SocialLinks({
  profile,
  onEdit,
}: {
  profile: UserProfile;
  onEdit?: (platform: Platform) => void;
}) {
  const t = useT();
  const links = objectValue(profile['socialLinks']);

  return (
    <div class="profile-socials">
      {PLATFORMS.map((platform) => {
        const label = t(`profile.platform.${platform}`);
        const href = socialHref(platform, links[platform]);
        if (onEdit) {
          return (
            <button
              key={platform}
              type="button"
              class={`profile-social${href ? ' is-active' : ''}`}
              onClick={() => onEdit(platform)}
              aria-label={`${t('profile.socialEdit')}：${label}`}
            >
              <Text>{label}</Text>
            </button>
          );
        }
        return href ? (
          <a
            key={platform}
            class="profile-social is-active"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Text>{label}</Text>
          </a>
        ) : null;
      })}
    </div>
  );
}

export function ProfileHeader({ profile }: { profile: UserProfile }) {
  const t = useT();
  const role = profileRole(profile['role']);
  return (
    <header class="profile-header">
      <Avatar
        name={profile.name}
        pictureUrl={stringValue(profile['pictureUrl']) || null}
        role={role}
        size="lg"
        class="profile-avatar"
        decorative
      />
      <h2 class="profile-name"><Text>{profile.name}</Text></h2>
      {/* 身分標籤只顯示角色（A 的角色底色），不是可點的人名連結。 */}
      <span class={`profile-role profile-role--${role}`}>
        <Text>{t(`profile.role.${String(role)}`)}</Text>
      </span>
      {/* 經驗值為預留功能；不渲染等級、經驗條、稱號或管理員隱身控制。 */}
    </header>
  );
}

export function Clubs({ profile }: { profile: UserProfile }) {
  const t = useT();
  // ASSUMPTION: 未附俱樂部讀模型；只展示文件既有 teamName / teamNames，
  // 不把 viewer.teamIds（可見權限集合）誤當實際所屬俱樂部。
  const names = Array.isArray(profile['teamNames'])
    ? profile['teamNames'].filter((value): value is string =>
      typeof value === 'string' && value.trim().length > 0)
    : [];
  const single = stringValue(profile['teamName']);
  const all = [...new Set([...names, ...(single ? [single] : [])])];

  return (
    <div class="profile-info-row">
      <Text>{t('profile.clubs')}</Text>
      <div class="profile-clubs">
        {all.length > 0
          ? all.map((name) => <Text key={name} class="profile-club">{name}</Text>)
          : <Text>{t('profile.notProvided')}</Text>}
      </div>
    </div>
  );
}
