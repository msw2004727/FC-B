// 營運儀表板 W6 截圖台：?variant=B 時推播裝置卡換成方案 B，其他（預設）用正式的方案 A。
import type { JSX } from 'preact';

import type { WebPushCounts } from '@/features/ops-dashboard/data/ops-summary-types';
import type { OpsT } from '@/features/ops-dashboard/ops-strings';
import { OpsPushCard as StackCard } from '@/features/ops-dashboard/components/OpsPushCard';
import { OpsPushCard as BarsCard } from './ops-w6-push-bars';

export * from '@/features/ops-dashboard/components/OpsPushCard';

const variant = new URLSearchParams(location.search).get('variant') === 'B' ? 'B' : 'A';

export function OpsPushCard(props: { counts: WebPushCounts | null; t: OpsT }): JSX.Element {
  return variant === 'B' ? <BarsCard {...props} /> : <StackCard {...props} />;
}
