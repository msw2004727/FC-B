// 正式頁才掛。注入環境存在時，頁面不會渲染這個元件，也就不會讀 viewer 或連線。
// loadClubs 為 false 時不查代表俱樂部。站內賽事要等開賽閘門通過才打開。

import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useSettledViewerRole, useViewer } from '@/features/profile/data/viewer';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import type { CpClub } from './access';
import { getCompetitionsRepo } from './data/cp-repo';
import type { CpActor } from './env';
import { loadRepClubs } from './rep-clubs';

const NO_CLUBS: CpClub[] = [];

export function LiveBoundary({
  children,
  loadClubs = true,
}: {
  children: (actor: CpActor, repo: ReturnType<typeof getCompetitionsRepo>) => ComponentChildren;
  /** false：先不要查 teams。閘門不過時一筆代表俱樂部讀取都不發。 */
  loadClubs?: boolean;
}) {
  const viewer = useViewer();
  // 清單記下是替哪個 uid 讀完的。pending 跟著目前 uid 在 render 當下算，
  // uid 從 null 變成有值的那一輪就已是 pending，子頁的 effect 不會照空清單先讀（取代原本在 effect 裡 setPending，Opus 審 P2）。
  const [loaded, setLoaded] = useState<{ uid: string; clubs: CpClub[] } | null>(null);
  const repo = useMemo(() => getCompetitionsRepo(), []);

  useEffect(() => {
    const uid = viewer.uid;
    if (!loadClubs || !uid) return undefined;
    let alive = true;
    void loadRepClubs(uid).then((rows) => {
      if (alive) setLoaded({ uid, clubs: rows });
    }).catch(() => {
      if (alive) setLoaded({ uid, clubs: [] });
    });
    return () => {
      alive = false;
    };
  }, [viewer.uid, loadClubs]);

  const clubsReady = loadClubs && !!viewer.uid && loaded?.uid === viewer.uid;
  const repClubs = clubsReady && loaded ? loaded.clubs : NO_CLUBS;
  // 還沒查完時空陣列不代表沒有俱樂部。未登入不查，視為已定案；loadClubs 為 false 時維持 pending。
  const repClubsPending = !loadClubs || (!!viewer.uid && !clubsReady);

  // 角色只等 users 文件（settledRole），不等球隊掃描等其餘 viewer 欄位（顧問 11-20：閘門只等角色確定）。
  // 完整 viewer 到了就以 viewer.role 為準；兩者都沒到時 rolePending，閘門先不判定（Opus 審 P2-1）。
  // 完整 viewer 若一直沒到，role 停在已確定的角色、其餘欄位維持最小值：刻意如此，比一直 pending 好（11-20 Opus 審 P3-3）。
  const settledRole = useSettledViewerRole(viewer.uid);
  const fullLoaded = !!viewer.uid && isViewerPermissionsLoaded(viewer);
  const actor: CpActor = {
    uid: viewer.uid,
    authPending: viewer.authPending === true,
    rolePending: !!viewer.uid && !fullLoaded && settledRole === null,
    role: fullLoaded || settledRole === null ? viewer.role : settledRole,
    displayName: viewer.displayName,
    repClubs,
    repClubsPending,
    memberClubIds: [...viewer.teamIds],
  };

  return <>{children(actor, repo)}</>;
}
