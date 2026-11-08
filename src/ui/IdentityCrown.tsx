import type { JSX } from 'preact';
import { useId } from 'preact/hooks';

/**
 * 第二身份金色反光皇冠（照 A `profile-avatar.js#_identityCrownBadgeHtml`；樣式 `.identity-crown*` 在 legacy base.css）。
 * 放在 `position: relative` 的頭像容器內，由容器的 `--identity-crown-size` 決定大小，疊在頭像正上方。
 * 同頁可能同時有頂部列、抽屜、個人頁三個皇冠：漸層與裁切 id 每個實例各自產生，避免重複 id 在某處被 display:none 時其他皇冠失去漸層。
 */
export function IdentityCrownSvg(): JSX.Element {
  const uid = useId();
  const goldId = `identityCrownGold-${uid}`;
  const clipId = `identityCrownClip-${uid}`;
  return (
    <svg class="identity-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={goldId} x1="3" y1="5" x2="20" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff4c2" />
          <stop offset=".42" stop-color="#ffd24a" />
          <stop offset=".72" stop-color="#f2a517" />
          <stop offset="1" stop-color="#b5710b" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z" />
        </clipPath>
      </defs>
      <path class="identity-crown-body" style={{ fill: `url(#${goldId})` }} d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z" />
      <path class="identity-crown-band" d="M4 15.3h16" />
      <circle class="identity-crown-gem" cx="12" cy="5.9" r="1.6" />
      <circle class="identity-crown-gem" cx="2.9" cy="9.1" r="1.3" />
      <circle class="identity-crown-gem" cx="21.1" cy="9.1" r="1.3" />
      <g clip-path={`url(#${clipId})`}>
        <rect class="identity-crown-shine" x="-9" y="-5" width="7" height="34" />
      </g>
    </svg>
  );
}
