import type { JSX } from 'preact';
import { useLocation } from 'preact-iso';

import OpsDashboardPage from './OpsDashboardPage';
import OpsParticipantsPage from './OpsParticipantsPage';

/**
 * 兩條路由（/admin/ops、/admin/ops/participants）共用同一個延遲載入 chunk：
 * 首頁主程式裡的動態載入對應表只多一組檔名（每多一個 chunk，主程式就多一段檔名清單，首頁 gzip 已貼近 60KB 上限）。
 */
export default function OpsPage(): JSX.Element {
  const { path } = useLocation();
  return path.startsWith('/admin/ops/participants') ? <OpsParticipantsPage /> : <OpsDashboardPage />;
}
