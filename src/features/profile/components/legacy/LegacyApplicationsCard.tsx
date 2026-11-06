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
  /** 11-06 改版：頁面已用 useMyTeamApplications 讀好時直接傳入，卡片不再自己讀。 */
  items?: LatestTeamApplication[] | null;
  /** 11-06 改版：放進個人頁圖示列的展開區時只渲染內容（外殼由 ProfileQuickBar 負責）。 */
  embedded?: boolean;
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

/**
 * 讀取「我的俱樂部申請」（一次 inbox＋俱樂部清單）。null＝讀取中；空陣列＝沒有申請（卡片／圖示不顯示）。
 * 11-06 改版：從卡片抽出，讓個人頁圖示列在收合時就知道要不要顯示「申請」（讀取次數與原本卡片相同）。
 */
export function useMyTeamApplications(
  uid: string,
  profile: UserProfile,
  enabled = true,
): LatestTeamApplication[] | null {
  const [items, setItems] = useState<LatestTeamApplication[] | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [uid, profile, enabled]);

  return items;
}

export function LegacyApplicationsCard(
  props: LegacyApplicationsCardProps,
): JSX.Element | null {
  const { uid, profile, embedded = false } = props;
  const lt = useLegacyT();

  const loaded = useMyTeamApplications(uid, profile, props.items === undefined);
  const items = props.items === undefined ? loaded : props.items;
  const [openState, setOpen] = useState(false);
  const open = embedded || openState;

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
    <div class={embedded ? 'profile-quick-body' : 'info-card'} id="profile-applications-card">
      {!embedded && (
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
      )}
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
