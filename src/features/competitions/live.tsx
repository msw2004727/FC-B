// 正式頁才掛。注入環境存在時，頁面不會渲染這個元件，也就不會讀 viewer 或連線。
// loadClubs 為 false 時不查代表俱樂部。站內賽事要等開賽閘門通過才打開。

import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useViewer } from '@/features/profile/data/viewer';
import type { CpClub } from './access';
import { getCompetitionsRepo } from './data/cp-repo';
import type { CpActor } from './env';
import { loadRepClubs } from './rep-clubs';

export function LiveBoundary({
  children,
  loadClubs = true,
}: {
  children: (actor: CpActor, repo: ReturnType<typeof getCompetitionsRepo>) => ComponentChildren;
  /** false：先不要查 teams。閘門不過時一筆代表俱樂部讀取都不發。 */
  loadClubs?: boolean;
}) {
  const viewer = useViewer();
  const [repClubs, setRepClubs] = useState<CpClub[]>([]);
  // 還沒查完時空陣列不代表沒有俱樂部。
  const [repClubsPending, setRepClubsPending] = useState(true);
  const repo = useMemo(() => getCompetitionsRepo(), []);

  useEffect(() => {
    if (!loadClubs) {
      setRepClubs([]);
      setRepClubsPending(true);
      return;
    }
    if (!viewer.uid) {
      setRepClubs([]);
      setRepClubsPending(false);
      return;
    }
    let alive = true;
    setRepClubs([]);
    setRepClubsPending(true);
    void loadRepClubs(viewer.uid).then((rows) => {
      if (!alive) return;
      setRepClubs(rows);
      setRepClubsPending(false);
    }).catch(() => {
      if (!alive) return;
      setRepClubs([]);
      setRepClubsPending(false);
    });
    return () => {
      alive = false;
    };
  }, [viewer.uid, loadClubs]);

  const actor: CpActor = {
    uid: viewer.uid,
    authPending: viewer.authPending === true,
    role: viewer.role,
    displayName: viewer.displayName,
    repClubs,
    repClubsPending,
    managedClubs: (viewer.staffTeams ?? []).map((team) => ({ id: team.id, name: team.name })),
    memberClubIds: [...viewer.teamIds],
  };

  return <>{children(actor, repo)}</>;
}
