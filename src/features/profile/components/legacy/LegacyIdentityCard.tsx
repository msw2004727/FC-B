import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { UserProfile } from '../../data/profile-model';
import { LegacyAvatar } from './LegacyProfileHeader';
import { UNAVAILABLE_MSG, extractSecondaryIdentity } from './profile-legacy-helpers';

export function LegacyIdentityCard({
  profile,
  onOpenEditor,
}: {
  profile: UserProfile;
  onOpenEditor: () => void;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const secondary = extractSecondaryIdentity(profile);
  const previewName = secondary.displayName || '次身份';
  const summaryName = secondary.enabled
    ? (secondary.displayName || '次身份')
    : (secondary.displayName || '使用主身份');

  return (
    <div
      class={`info-card${secondary.enabled ? ' is-secondary-enabled' : ''}`}
      id="profile-identity-card"
      data-permission-code="profile.secondary_identity"
    >
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <button
            type="button"
            class="edu-info-btn"
            title={lt('說明', '說明')}
            data-i18n-title="說明"
            onClick={(e) => {
              e.stopPropagation();
              toast.show({ message: UNAVAILABLE_MSG });
            }}
          >
            ?
          </button>
          <span data-i18n="第二身份">{lt('第二身份', '第二身份')}</span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      <div class="profile-collapse-content" style={open ? undefined : 'display:none'}>
        {/* 下一批補：A 的第二身份行內編輯與頭像上傳；本批開關與編輯按鈕先開啟 B 既有 IdentityEditor */}
        <div class="profile-identity-control">
          <label class={`profile-identity-toggle${secondary.enabled ? ' active' : ''}`}>
            <span data-i18n="啟用">{lt('啟用', '啟用')}</span>
            <span class="toggle-switch">
              <input
                type="checkbox"
                id="profile-secondary-enabled"
                checked={secondary.enabled}
                onChange={() => onOpenEditor()}
              />
              <span class="toggle-slider" />
            </span>
          </label>
        </div>
        <div class="profile-identity-summary">
          <LegacyAvatar
            id="profile-secondary-avatar-preview"
            url={secondary.avatarUrl}
            name={previewName}
            baseClass="profile-identity-avatar"
            imageContainerClass="profile-identity-avatar"
            crown
          />
          <div class="profile-identity-summary-copy">
            <div
              class="profile-identity-summary-name"
              id="profile-secondary-summary-name"
              data-i18n="使用主身份"
            >
              {summaryName}
            </div>
            <div
              class="profile-identity-summary-status"
              id="profile-secondary-summary-status"
              data-i18n="啟用後會直接以第二身份顯示"
            >
              {secondary.enabled ? (
                <>
                  目前身份已啟用
                  <ul class="profile-identity-capability-list">
                    <li>活動留言與回覆</li>
                    <li>用戶資料卡片</li>
                    <li>右上角與我的資料顯示</li>
                  </ul>
                </>
              ) : (
                lt('啟用後會直接以第二身份顯示', '啟用後會直接以第二身份顯示')
              )}
            </div>
          </div>
          <button
            type="button"
            class="outline-btn small profile-identity-edit-btn"
            id="profile-identity-edit-btn"
            aria-label={t('profile.identity')}
            data-i18n="編輯"
            onClick={onOpenEditor}
          >
            {lt('編輯', '編輯')}
          </button>
        </div>
      </div>
    </div>
  );
}
