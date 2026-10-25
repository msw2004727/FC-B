/**
 * M-126「我的俱樂部申請」卡（照 A `profile-data-history.js#_getMyLatestTeamApplications`、
 * `_renderMyApplications`；顯示條件照 `profile-data-render.js#_showApplicationsCard`；
 * DOM 照 `pages/profile.html#221-227`）。
 *
 * 資料來源：一次 `getDocs(users/{uid}/inbox)`（`orderBy(createdAt,'desc')+limit(200)`），
 * 以 `normalizeInboxMessage` 正規化；俱樂部清單以 `loadTeams()` 取現存俱樂部。
 * 分類／去重／時間解析／狀態文字／badge 全在 `profile-applications.ts`。只讀，不寫入。
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import { useLegacyT } from '@/i18n/i18n';
import { getFirebase } from '@/data/firebase';
import { userInbox } from '@/data/paths';
import { loadTeams } from '@/features/clubs/data/teams-repo';
import {
  normalizeInboxMessage,
  type InboxMessage,
} from '@/features/inbox/data/inbox-repo';

import type { UserProfile } from '../../data/profile-model';
import {
  getApplicationStatusDisplay,
  getMyLatestTeamApplications,
  type LatestTeamApplication,
} from '../../data/profile-applications';

export interface LegacyApplicationsCardProps {
  uid: string;
  profile: UserProfile;
}

function extractTeamIds(profile: UserProfile): string[] {
  // 照 A `_getUserTeamIds` fallback：`teamIds[] ∪ { teamId }`，trim＋去重。
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown): void => {
    const v = String(raw ?? '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  const list = (profile as Record<string, unknown>)['teamIds'];
  if (Array.isArray(list)) list.forEach(push);
  push((profile as Record<string, unknown>)['teamId']);
  return ids;
}

interface DocsSnap {
  forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => void;
}

async function loadInboxMessages(uid: string): Promise<InboxMessage[]> {
  const [fsMod, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const { collection, getDocs, query, orderBy, limit } = fsMod;
  const ref = collection(ctx.db, userInbox(uid));
  const q = query(ref, orderBy('createdAt', 'desc'), limit(200));
  const snap = (await getDocs(q)) as unknown as DocsSnap;
  const out: InboxMessage[] = [];
  snap.forEach((child) => {
    const data = child.data();
    const record = (data && typeof data === 'object')
      ? (data as Record<string, unknown>)
      : {};
    out.push(normalizeInboxMessage(child.id, record));
  });
  return out;
}

export function LegacyApplicationsCard(
  props: LegacyApplicationsCardProps,
): JSX.Element | null {
  const { uid, profile } = props;
  const lt = useLegacyT();

  const [items, setItems] = useState<LatestTeamApplication[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const [teams, messages] = await Promise.all([
          loadTeams(),
          loadInboxMessages(uid),
        ]);
        const latest = getMyLatestTeamApplications(messages, {
          uid,
          teamIds: extractTeamIds(profile),
          liveTeams: teams,
        });
        if (!cancelled) setItems(latest);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[LegacyApplicationsCard] load failed', err);
        if (!cancelled) setItems([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [uid, profile]);

  const toggleOpen = useCallback((): void => {
    setOpen((o) => !o);
  }, []);

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        toggleOpen();
      }
    },
    [toggleOpen],
  );

  if (items === null) return null;
  if (items.length === 0) return null;

  return (
    <div class="info-card" id="profile-applications-card">
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open ? 'true' : 'false'}
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
      >
        <span>
          {lt('我的俱樂部申請', '我的俱樂部申請')}{' '}
          <span class="fav-count-badge" id="app-count-badge">{items.length}</span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      <div
        class="profile-collapse-content"
        id="profile-applications-list"
        style={open ? '' : 'display:none'}
      >
        {open
          ? items.map((m) => {
              const display = getApplicationStatusDisplay(m.status);
              return (
                <div
                  key={m.messageId}
                  style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)"
                >
                  <span style="font-size:.82rem">{m.teamName || '-'}</span>
                  <span style={`font-size:.72rem;font-weight:600;color:${display.color}`}>
                    {display.label}
                  </span>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
