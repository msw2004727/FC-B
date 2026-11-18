// 正式頁才掛。注入環境存在時，頁面不會渲染這個元件，也就不會讀 viewer 或連線。

import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useViewer } from '@/features/profile/data/viewer';
import { liveCpActions } from './actions';
import type { CpClub } from './access';
import { getCompetitionsRepo } from './data/cp-repo';
import type { CpActor } from './env';
import { loadRepClubs } from './rep-clubs';

export function LiveBoundary({
  children,
}: {
  children: (actor: CpActor, repo: ReturnType<typeof getCompetitionsRepo>) => ComponentChildren;
}) {
  const viewer = useViewer();
  const [repClubs, setRepClubs] = useState<CpClub[]>([]);
  const repo = useMemo(() => getCompetitionsRepo(), []);

  useEffect(() => {
    if (!viewer.uid) {
      setRepClubs([]);
      return;
    }
    let alive = true;
    void loadRepClubs(viewer.uid).then((rows) => {
      if (alive) setRepClubs(rows);
    }).catch(() => {
      if (alive) setRepClubs([]);
    });
    return () => {
      alive = false;
    };
  }, [viewer.uid]);

  const actor: CpActor = {
    uid: viewer.uid,
    authPending: viewer.authPending === true,
    role: viewer.role,
    displayName: viewer.displayName,
    repClubs,
    managedClubs: (viewer.staffTeams ?? []).map((team) => ({ id: team.id, name: team.name })),
    memberClubIds: [...viewer.teamIds],
  };

  return <>{children(actor, repo)}</>;
}
