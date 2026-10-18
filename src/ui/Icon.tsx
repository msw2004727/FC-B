import type { JSX } from 'preact';

export type IconName =
  | 'home'
  | 'calendar'
  | 'qr'
  | 'user'
  | 'users'
  | 'book'
  | 'inbox'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'globe';

export interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
}

function pathsFor(name: IconName): JSX.Element | null {
  switch (name) {
    case 'home':
      return (
        <>
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
        </>
      );
    case 'qr':
      return (
        <>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <path d="M14 14h3v3h-3z" />
          <path d="M20 14h1" />
          <path d="M14 20h1" />
          <path d="M20 20h1" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </>
      );
    case 'users':
      return (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
          <circle cx="17" cy="8" r="3" />
          <path d="M22 21c0-3-2-5-5-5" />
        </>
      );
    case 'book':
      return (
        <>
          <path d="M4 4h9a3 3 0 013 3v13H7a3 3 0 01-3-3z" />
          <path d="M16 4h4v16h-4" />
        </>
      );
    case 'inbox':
      return (
        <>
          <path d="M4 4h16v10l-3 5h-5l-3-5H4z" />
          <path d="M4 14h4" />
          <path d="M20 14h-4" />
        </>
      );
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="M4.2 4.2l1.4 1.4" />
          <path d="M18.4 18.4l1.4 1.4" />
          <path d="M4.2 19.8l1.4-1.4" />
          <path d="M18.4 5.6l1.4-1.4" />
        </>
      );
    case 'moon':
      return <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />;
    case 'globe':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a13 13 0 010 18" />
          <path d="M12 3a13 13 0 000 18" />
        </>
      );
  }
}

/** 內嵌 SVG 圖示，線性、18px、currentColor。 */
export function Icon({ name, size = 18, class: className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      {pathsFor(name)}
    </svg>
  );
}
