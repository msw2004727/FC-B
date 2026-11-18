import type { JSX } from 'preact';
import type { IntensityChoice } from '../../data/activity-categories';

/** 分類圖示：一般＝靶心、新手友善＝新芽、高強度＝閃電。 */
export function IntensityIcon({ level }: { level: IntensityChoice }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      {level === 'beginner' ? (
        <>
          <path d="M12 21v-8.5" />
          <path d="M12 12.5c0-4.4 3-7.5 8-7.5 0 5-3.2 8-8 7.5z" />
          <path d="M12 15c0-3.3-2.6-5.8-7-5.8 0 4 2.6 6.3 7 5.8z" />
        </>
      ) : level === 'high-intensity' ? (
        <path d="M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="3.2" />
        </>
      )}
    </svg>
  );
}
