// 賽事範圍的狀態標籤：呼叫處只說是哪一種狀態，長相由 competitions.css 的 .d2-tag--* 決定。

import type { JSX } from 'preact';
import { Badge } from '@/ui/Badge';

/**
 * live＝亮燈，只給「進行中」。
 * cancelled＝紅字描邊，只給比賽或賽事「已取消」與管理員區「已下架」；其他取消類的狀態不要掛這一種。
 * next＝青綠字描邊，「下一場」記號，不是狀態。
 * neutral＝中性描邊，其餘全部。
 */
export type StatusKind = 'live' | 'cancelled' | 'neutral' | 'next';

export function StatusTag({ kind, label, class: className }: { kind: StatusKind; label: string; class?: string }): JSX.Element {
  return (
    <Badge
      size="sm"
      tone={kind === 'cancelled' ? 'danger' : 'neutral'}
      label={label}
      class={['d2-tag', `d2-tag--${kind}`, className].filter(Boolean).join(' ')}
    />
  );
}
