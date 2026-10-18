import './skeleton.css';
import type { JSX } from 'preact';

export interface SkeletonProps {
  shape?: 'text' | 'rect' | 'circle';
  lines?: 1 | 2;
  /** 與最終內容使用相同尺寸；CSS 長度字串或像素數字。 */
  width?: number | string;
  height?: number | string;
  class?: string;
}

/**
 * Skeleton 本身不進入無障礙樹。
 * 載入中的實際內容容器由使用端設定 aria-busy="true"。
 */
export function Skeleton({
  shape = 'text',
  lines = 1,
  width,
  height,
  class: className = '',
}: SkeletonProps): JSX.Element {
  const dimension = (value: number | string): string =>
    typeof value === 'number' ? `${Math.max(0, value)}px` : value;

  return (
    <span
      class={[
        'ui-skeleton',
        `ui-skeleton--${shape}`,
        shape === 'text' ? `ui-skeleton--lines-${lines}` : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-hidden="true"
      style={{
        ...(width !== undefined ? { width: dimension(width) } : {}),
        ...(height !== undefined ? { height: dimension(height) } : {}),
      }}
    >
      <span class="ui-skeleton__surface" />
      {shape === 'text' && lines === 2 && (
        <span class="ui-skeleton__surface" />
      )}
    </span>
  );
}
