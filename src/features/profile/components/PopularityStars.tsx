/**
 * 人氣星列（0～5，0.5 顆）。填色與深淺色空星都在 popularity-stars.css，這裡不判斷主題。
 */
import type { JSX } from 'preact';
import { useId } from 'preact/hooks';

import { useT } from '@/i18n/i18n';

import './popularity-stars.css';

const STAR_PATH = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z';

type StarKind = 'full' | 'half' | 'empty';

function clampScore(score: number): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0;
  return Math.min(5, Math.max(0, score));
}

/** 整數不帶小數；半星顯示一位（3.5）。 */
function formatStarCount(score: number): string {
  const nearest = Math.round(clampScore(score) * 2) / 2;
  return Number.isInteger(nearest) ? String(nearest) : nearest.toFixed(1);
}

function starKinds(score: number): StarKind[] {
  const halves = Math.round(clampScore(score) * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  return Array.from({ length: 5 }, (_, i): StarKind => {
    if (i < full) return 'full';
    if (half && i === full) return 'half';
    return 'empty';
  });
}

export function PopularityStars({ score }: { score: number }): JSX.Element {
  const t = useT();
  // useId 每個實例不同；半星再加索引，同頁多顆、多個元件的 gradient id 不衝突。
  const baseId = `pop${useId().replace(/:/g, '')}`;
  const kinds = starKinds(score);
  return (
    <div
      class="popularity-stars"
      role="img"
      aria-label={t('profile.playerCard.popularityAria', { stars: formatStarCount(score) })}
    >
      {kinds.map((kind, i) => {
        const gradId = `${baseId}-h${i}`;
        return (
          <svg key={i} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {kind === 'half' && (
              <defs>
                <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stop-color="var(--pop-star-fill)" />
                  <stop offset="50%" stop-color="var(--pop-star-fill)" />
                  <stop offset="50%" stop-color="var(--pop-star-empty)" />
                  <stop offset="100%" stop-color="var(--pop-star-empty)" />
                </linearGradient>
              </defs>
            )}
            <path
              class={kind === 'half' ? undefined : `is-${kind}`}
              d={STAR_PATH}
              fill={kind === 'half' ? `url(#${gradId})` : undefined}
              stroke="var(--pop-star-stroke)"
              stroke-width=".8"
              stroke-linejoin="round"
            />
          </svg>
        );
      })}
    </div>
  );
}
