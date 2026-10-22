import type { JSX } from 'preact';

import { useGoBack } from '@/core/back-guard';
import { lt } from '@/i18n/i18n';
import { LegacyUserCard } from '../components/legacy/LegacyUserCard';
import QrPage from './QrPage';
// A 的 .uc-* 與 .user-card-full 樣式在 profile.css。
import '../legacy/profile.css';

/**
 * 照 A `pages/profile.html#page-user-card`／`profile-core.js#showUserProfile`（M-133）：
 * 頁首照 A（返回鈕＋「用戶資料卡片」），內容由 `LegacyUserCard` 輸出 A 的 DOM。
 * 原本 B 自行組裝的 `publicProjection`（遇第二身份整張不顯示）已移除，改成 A 行為：對方開第二身份不影響他人看到的名片。
 */
export default function PublicProfilePage({ uid = '' }: { uid?: string }): JSX.Element {
  const goBack = useGoBack('/');
  // preact-iso 的參數直接傳入頁面；保留既有 `qr` 導向防護，避免保留字進入使用者資料查詢。
  if (uid === 'qr') return <QrPage />;
  return (
    <div class="legacy-ui">
      <section class="page active" id="page-user-card">
        <div class="page-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={goBack}
          >
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
          <h2 data-i18n="用戶資料卡片">{lt('用戶資料卡片', '用戶資料卡片')}</h2>
        </div>
        <LegacyUserCard key={uid} uid={uid} />
      </section>
    </div>
  );
}
