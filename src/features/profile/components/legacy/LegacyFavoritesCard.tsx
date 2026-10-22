/**
 * M-125「我的收藏」卡（照 A `favorites.js#_showFavoritesCard`／`renderProfileFavorites`／
 * `_getFavoriteEventBadge`／`_statusSortWeight`／`toggleFavoriteEvent`；DOM 照
 * `pages/profile.html#214-220`）。
 *
 * - 只以「收藏」為資料來源：`loadFavorites(uid)`；tournaments 一律保留但不渲染
 *   （B 目前無賽事讀取來源，回覆列為缺口）。
 * - 活動可見性交由 `canListPrivateEvent`（R-EVT-010）。
 * - 移除：`toggleEventInFavorites` + `saveFavorites`（與活動詳情同一寫入）。
 * - 全卡預設收起；展開才渲染列表；`role="button"`、`aria-expanded`、Enter／Space 展開。
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import {
  loadFavorites,
  saveFavorites,
  toggleEventInFavorites,
} from '@/features/events/data/favorites';
import { loadEventDetail } from '@/features/events/data/event-detail';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import { canListPrivateEvent } from '@/features/events/data/visibility';
import type { EventDoc, RegistrationDoc, ViewerContext } from '@/features/events/data/types';
import { STATUS_CONFIG } from '@/features/events/components/legacy/TimelineEventCard';

import { useViewer } from '../../data/viewer';
import type { UserProfile } from '../../data/profile-model';
import { ProfileInfoButton } from './ProfileInfoButton';

export interface LegacyFavoritesCardProps {
  uid: string;
  profile: UserProfile;
}

type SortMode = 'time' | 'status' | 'name';

interface FavItem {
  eventId: string;
  name: string;
  date: string;
  statusCss: string;
  statusLabel: string;
  sortDate: string;
}

interface StatusBadge {
  css: string;
  label: string;
}

// ── 純函式（照 A `favorites.js`） ─────────────────────

/** 照 A `_statusSortWeight`：open 最前、ended／cancelled 最後，未知 → 9。 */
export function statusSortWeight(css: string): number {
  const w: Record<string, number> = {
    open: 1,
    upcoming: 2,
    full: 3,
    ended: 4,
    cancelled: 5,
  };
  return w[css] ?? 9;
}

function statusConfig(eventStatus: string): StatusBadge {
  // 照 A `_getFavoriteEventBadge`：`STATUS_CONFIG[eventStatus] || STATUS_CONFIG.open`。
  const cfg = STATUS_CONFIG[eventStatus] ?? STATUS_CONFIG['open'];
  if (!cfg) return { css: 'open', label: '報名中' };
  return { css: cfg.css, label: cfg.label };
}

function readField(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

function readString(obj: unknown, key: string): string {
  const v = readField(obj, key);
  return typeof v === 'string' ? v : '';
}

/**
 * 照 A `_getFavoriteEventBadge`：`STATUS_CONFIG` 當 fallback，
 * 再依登入者報名狀態覆蓋。呼叫端已先按 viewer 的 userId + eventId 篩選過。
 */
export function getFavoriteEventBadge(
  eventStatus: string,
  viewerRegistrationsForEvent: readonly RegistrationDoc[],
): StatusBadge {
  const fallback = statusConfig(eventStatus);
  const regs = Array.isArray(viewerRegistrationsForEvent) ? viewerRegistrationsForEvent : [];
  if (regs.length === 0) return fallback;
  if (regs.some((r) => readString(r, 'status') === 'confirmed')) {
    return { css: 'open', label: '已報名' };
  }
  if (regs.some((r) => readString(r, 'status') === 'waitlisted')) {
    return { css: 'full', label: '候補中' };
  }
  if (regs.some((r) => {
    const s = readString(r, 'status');
    return s === 'cancelled' || s === 'removed';
  })) {
    return { css: 'cancelled', label: '已取消報名' };
  }
  return fallback;
}

/** 照 A `renderProfileFavorites` 的排序（time／status／name）。 */
function sortFavItems(items: readonly FavItem[], mode: SortMode): FavItem[] {
  const copy = [...items];
  if (mode === 'status') {
    copy.sort((a, b) => statusSortWeight(a.statusCss) - statusSortWeight(b.statusCss));
  } else if (mode === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  } else {
    copy.sort((a, b) => (b.sortDate || '').localeCompare(a.sortDate || ''));
  }
  return copy;
}

/** 照 A `getRegistrationHistoryByEventUser`：把 viewer 報名按 eventId 分組。 */
export function groupRegistrationsByEvent(
  regs: readonly RegistrationDoc[],
): Map<string, RegistrationDoc[]> {
  const map = new Map<string, RegistrationDoc[]>();
  for (const reg of regs) {
    const eid = readString(reg, 'eventId');
    if (!eid) continue;
    const arr = map.get(eid);
    if (arr) arr.push(reg);
    else map.set(eid, [reg]);
  }
  return map;
}

// ── 元件 ─────────────────────────────────────────────

export function LegacyFavoritesCard(props: LegacyFavoritesCardProps): JSX.Element | null {
  const { uid } = props;
  const lt = useLegacyT();
  // 照附件 `LegacyProfileCards.tsx`：導頁改用 preact-iso 的 `useLocation()`。
  const location = useLocation();
  // 照 A `_getFavoriteEventBadge`：可見性與身分用 `useViewer()`，不逐活動讀整份名單。
  const viewer = useViewer();

  const [items, setItems] = useState<FavItem[] | null>(null);
  const [rawTotal, setRawTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('time');
  const savingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // viewer 尚未就緒時先不查詢，避免用 guest 身分（roleLevel=0）把私密活動錯擋。
    const viewerUid = viewer.uid;
    if (!viewerUid) return undefined;
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        // 照 A `getRegistrationHistoryByEventUser`：viewer 報名一次抓，再依 eventId 分組。
        const [favs, viewerRegs] = await Promise.all([
          loadFavorites(uid),
          loadViewerRegistrations(viewerUid),
        ]);
        const regsByEvent = groupRegistrationsByEvent(viewerRegs);
        const raw = favs.events.length + favs.tournaments.length;
        const viewerContext: ViewerContext = viewer;

        // 刻意不移植 A `_getSanitizedFavorites` 在渲染時寫回 users.favorites 的自動清理寫入。
        const resolved = await Promise.all(
          favs.events.map(async (eventId) => {
            try {
              const detail = await loadEventDetail(eventId);
              if (!detail) return null;
              if (!canListPrivateEvent(detail.event, viewerContext)) return null;
              return {
                eventId,
                event: detail.event,
                registrations: regsByEvent.get(eventId) ?? [],
              };
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) return;

        const favItems: FavItem[] = [];
        for (const r of resolved) {
          if (!r) continue;
          const status = readString(r.event, 'status');
          const title = readString(r.event, 'title');
          const dateRaw = readString(r.event, 'date');
          const dateStr = dateRaw ? (dateRaw.split(' ')[0] ?? '') : '';
          const badge = getFavoriteEventBadge(status, r.registrations);
          favItems.push({
            eventId: r.eventId,
            name: title,
            date: dateStr,
            statusCss: badge.css,
            statusLabel: badge.label,
            sortDate: dateStr,
          });
        }

        setRawTotal(raw);
        setItems(favItems);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[LegacyFavoritesCard] load failed', err);
        if (!cancelled) {
          setRawTotal(0);
          setItems([]);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [uid, viewer]);

  const handleRemove = useCallback(
    async (eventId: string): Promise<void> => {
      if (savingRef.current.has(eventId)) return;
      savingRef.current.add(eventId);
      try {
        const current = await loadFavorites(uid);
        const { next } = toggleEventInFavorites(current, eventId);
        await saveFavorites(uid, next);
        setItems((prev) => (prev ? prev.filter((x) => x.eventId !== eventId) : prev));
        setRawTotal((prev) => Math.max(0, prev - 1));
        toast.show({ message: lt('toast.favoriteRemoved', '已取消收藏') });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[LegacyFavoritesCard] remove failed', err);
      } finally {
        savingRef.current.delete(eventId);
      }
    },
    [uid, lt],
  );

  const handleSortChange = useCallback((ev: Event): void => {
    const target = ev.currentTarget as HTMLSelectElement | null;
    const v = target ? target.value : '';
    if (v === 'time' || v === 'status' || v === 'name') {
      setSortMode(v);
    }
  }, []);

  const handleOpenEvent = useCallback((eventId: string): void => {
    // 照附件 `LegacyProfileCards.tsx`：用 `useLocation().route()`，路由 `/events/:id`。
    location.route('/events/' + encodeURIComponent(eventId));
  }, [location]);

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
  if (rawTotal === 0) return null;

  const badgeCount = items.length;
  const sorted = sortFavItems(items, sortMode);

  const renderList = (): JSX.Element => {
    if (sorted.length === 0) {
      return (
        <div style="font-size:.82rem;color:var(--text-muted);padding:.3rem 0">
          {lt('暫無收藏', '暫無收藏')}
        </div>
      );
    }
    return (
      <>
        <div style="display:flex;justify-content:flex-end;margin-bottom:.25rem">
          <select
            id="fav-sort"
            value={sortMode}
            onChange={handleSortChange}
            style="font-size:.7rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);cursor:pointer"
          >
            <option value="time">{lt('fav.sortTime', '按時間')}</option>
            <option value="status">{lt('fav.sortStatus', '按狀態')}</option>
            <option value="name">{lt('fav.sortName', '按名稱')}</option>
          </select>
        </div>
        {sorted.map((it) => (
          <div key={it.eventId} class="fav-item">
            <span class="fav-item-name" onClick={() => handleOpenEvent(it.eventId)}>
              {it.name}
            </span>
            <span class="fav-item-date">{it.date}</span>
            <span class={`tl-event-status ${it.statusCss}`} style="font-size:.62rem">
              {it.statusLabel}
            </span>
            <button
              class="fav-remove-btn"
              title={lt('toast.favoriteRemoved', '已取消收藏')}
              onClick={(ev) => {
                ev.stopPropagation();
                void handleRemove(it.eventId);
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </>
    );
  };

  return (
    <div class="info-card" id="profile-favorites-card">
      <div
        class="info-title profile-collapse-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open ? 'true' : 'false'}
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <ProfileInfoButton infoKey="favorites" />
          <span>{lt('我的收藏', '我的收藏')}</span>
          {' '}
          <span class="fav-count-badge" id="fav-count-badge">{badgeCount}</span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      <div
        class="profile-collapse-content"
        id="profile-favorites-list"
        style={open ? '' : 'display:none'}
      >
        {open ? renderList() : null}
      </div>
    </div>
  );
}

// 為 `noUnusedLocals` 保留 import（EventDoc 用於 loadEventDetail 型別推導）。
export type { EventDoc };
