import type { JSX } from 'preact';
import { parseEventStartMs } from '@/core/event-time';
import { formatTaipei, taipeiParts } from '@/core/taipei-time';
import { useMemo } from 'preact/hooks';
import { TeamDetailWeekStrip } from './TeamDetailWeekStrip';
import { openHttpAnchor } from '@/core/open-external';
import { useT } from '@/i18n/i18n';
import { effectiveEventStatus } from '@/features/events/data/my-activities-model';
import { UserTag } from '@/ui/UserTag';
import type { EventDoc } from '@/features/events/data/types';
import {
  getTeamStaffIdentity,
  isTeamDetailSectionVisible,
} from '../../data/team-detail-model';
import { normalizeTeamContactLinks } from '../../data/team-contact-links';
import type { TeamDoc, TeamRosterRow } from '../../data/types';
import { LegacyTeamMembersCard } from './LegacyTeamMembersCard';
import { PlatformGlyph } from './TeamContactGlyph';
import {
  sanitizeHttpImageUrl,
  type V2TabKey,
} from './TeamDetailV2Header';

function getDateKey(ms: number | null): string {
  return ms === null ? '' : formatTaipei(ms, 'YYYY-MM-DD');
}

/** A `_buildTeamDetailV2EventRows` 直接讀活動文件的 `current`／`max`。 */
function readEventCount(event: EventDoc, key: 'current' | 'max'): number {
  const value = Number((event as Record<string, unknown>)[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getEventCoverImage(event: EventDoc): string {
  const variants = (event as Record<string, unknown>)['imageVariants'] as
    | Record<string, unknown>
    | undefined;
  return sanitizeHttpImageUrl(
    variants?.['cover'] ||
      (event as Record<string, unknown>)['coverImage'] ||
      (event as Record<string, unknown>)['image'] ||
      '',
  );
}

export function renderEventRows(
  events: readonly EventDoc[],
  limit: number,
  onSelectEvent: (eventId: string) => void,
): JSX.Element {
  const visible = events.slice(0, limit);
  if (!visible.length) {
    return <div class="td-v2-empty">目前沒有即將開始的俱樂部活動</div>;
  }
  return (
    <>
      {visible.map((e, idx) => {
        const eventId = String(e.id || e._docId || '').trim();
        const startMs = parseEventStartMs(e.date);
        const date = startMs === null ? null : taipeiParts(startMs);
        const dateStr = String(e.date ?? '');
        const month = date ? `${date.month}月` : dateStr.split(' ')[0] || '';
        const day = date ? String(date.day) : '';
        const statusKey = effectiveEventStatus(e);
        const status =
          statusKey === 'full' ? '已額滿' : statusKey === 'upcoming' ? '即將開放' : '報名中';
        const max = readEventCount(e, 'max');
        const current = readEventCount(e, 'current');
        const countText = max > 0 ? `${current}/${max} 名` : '';
        const image = getEventCoverImage(e);
        // C1（R-UI-027）：原本「時間 · 地點 · 人數」一行在 375px 會被折行；改在語意斷點分兩行：
        // 時間 · 人數／地點（地點過長以「…」收尾），人數不會被截掉。
        const timeText = [dateStr.split(' ')[1] || '', countText].filter(Boolean).join(' · ');
        const locationText = String(e.location ?? '').trim();
        return (
          <button
            key={eventId || `ev-${idx}`}
            class="td-v2-event-card"
            type="button"
            data-td-v2-action="event"
            data-event-id={eventId}
            onClick={() => {
              if (eventId) onSelectEvent(eventId);
            }}
          >
            {image ? (
              <span class="td-v2-event-cover">
                <img src={image} alt="" loading="lazy" decoding="async" />
              </span>
            ) : (
              <span class="td-v2-event-cover empty">
                <em>{month}</em>
                <strong>{day}</strong>
              </span>
            )}
            <span class="td-v2-event-card-body">
              <span class="td-v2-event-date">
                <em>{month}</em>
                <strong>{day}</strong>
              </span>
              <span class="td-v2-event-main">
                <strong>
                  {e.title || '未命名活動'}
                  <i class={statusKey === 'full' ? 'full' : ''}>{status}</i>
                </strong>
                {timeText ? <em>{timeText}</em> : null}
                {locationText ? <em>{locationText}</em> : null}
              </span>
              <b>›</b>
            </span>
          </button>
        );
      })}
    </>
  );
}



function resolvePersonName(
  uid: string,
  roster: readonly TeamRosterRow[],
  fallbackName?: string,
): string {
  const row = roster.find((r) => r.uid === uid);
  if (row && row.name) return row.name;
  const trimmed = String(fallbackName ?? '').trim();
  return trimmed || uid;
}

export interface TeamDetailV2PanelsProps {
  team: TeamDoc;
  activeTab: V2TabKey;
  /** C1：頁籤由頁面決定（課程先隱藏、沒資料的戰績與動態不出），面板跟著同一份清單。 */
  tabKeys: ReadonlySet<V2TabKey>;
  roster: readonly TeamRosterRow[];
  membersStatus: 'loading' | 'error' | 'guest' | 'ready';
  events: readonly EventDoc[];
  eventsStatus: 'loading' | 'error' | 'ready';
  totalGames: number;
  winRate: number;
  // ASSUMPTION: 未附介面原文，既有宣告為此單行；使用 import type 運算式避免假設檔頭 import 排列。
  viewer: import('../../data/types').ClubViewer;
  onTeamChanged: () => void | Promise<void>;
  /** K4：剔除成功後就地移除該列。 */
  onMemberRemoved?: (uid: string) => void;
  canCreateEvent: boolean;
  onCreateEvent: () => void;
  busy: boolean;
  onSelectTab: (tab: V2TabKey) => void;
  onSelectEvent: (eventId: string) => void;
  onOpenProfile: (uid: string) => void;
  onRetryMembers: () => void;
  onRetryEvents: () => void;
  onLogin: () => void;
}

export function TeamDetailV2Panels({
  team,
  activeTab,
  tabKeys,
  roster,
  membersStatus,
  events,
  eventsStatus,
  totalGames,
  winRate,
  // ASSUMPTION: 未附完整解構，既有成員管理 prop 採此單行解構。
  viewer,
  onTeamChanged,
  onMemberRemoved,
  canCreateEvent,
  onCreateEvent,
  busy,
  onSelectTab,
  onSelectEvent,
  onOpenProfile,
  onRetryMembers,
  onRetryEvents,
  onLogin,
}: TeamDetailV2PanelsProps): JSX.Element {
  const t = useT();
  const eventDaySet = useMemo(() => {
    const days = new Set<string>();
    for (const event of events) {
      const key = getDateKey(parseEventStartMs(event.date));
      if (key) days.add(key);
    }
    return days;
  }, [events]);
  const showEvents = tabKeys.has('events');
  const showMembers = tabKeys.has('members');
  const showRecord = tabKeys.has('record');
  const showFeed = tabKeys.has('feed');
  const showBio = isTeamDetailSectionVisible(team, 'bio');
  const showInfo = isTeamDetailSectionVisible(team, 'info');

  const staff = getTeamStaffIdentity(team);
  const captainUids = [...staff.captainUids];
  const leaderUids = [...staff.leaderUids];
  const coachUids = [...staff.coachUids];
  const coachNames = Array.isArray(team.coaches)
    ? team.coaches.map((n) => String(n ?? '').trim())
    : [];
  // A：contactLinksEnabled 才輸出社群按鈕（team-detail-v2-panels.js _buildTeamDetailV2InfoGrid）。
  const contactLinks = team.contactLinksEnabled ? normalizeTeamContactLinks(team.contactLinks) : [];
  const leaderNames = Array.isArray(team.leaders)
    ? team.leaders.map((n) => String(n ?? '').trim())
    : team.leader
      ? [String(team.leader).trim()]
      : [];

  const contactText = String(team['contact'] ?? '').trim();
  const bioText = typeof team.bio === 'string' ? team.bio : '';

  const wins = Number(team['wins'] || 0);
  const draws = Number(team['draws'] || 0);
  const losses = Number(team['losses'] || 0);
  const circle = Math.max(0, Math.min(289, Math.round(((winRate || 0) / 100) * 289)));

  const rawFeed = team['feed'];
  const feedPosts = Array.isArray(rawFeed) ? rawFeed.slice(0, 10) : [];

  return (
    <main class="td-v2-content">
      {/* 總覽（C1：拿掉與數字列重複的「快速導覽」） */}
      <section
        class={`td-v2-panel td-v2-panel-overview${activeTab === 'overview' ? ' active' : ''}`}
        data-panel="overview"
      >
        {showBio &&
          (bioText ? (
            <div class="td-v2-card">
              <div class="td-v2-section-head">
                <h3>關於我們</h3>
              </div>
              <p class="td-v2-bio">{bioText}</p>
            </div>
          ) : (
            <div class="td-v2-card td-v2-empty-card">尚未填寫俱樂部簡介</div>
          ))}

        {showInfo && (
          <div class="td-v2-card td-v2-info-card">
            <div class="td-v2-section-head">
              <h3>俱樂部資訊</h3>
            </div>
            <div class="td-v2-info-staff-grid">
              <div class="td-v2-staff-row">
                <span class="td-v2-staff-label">經理</span>
                <div class="td-v2-person-tags">
                  {captainUids.length > 0 ? (
                    captainUids.map((uid) => (
                      <UserTag
                        key={uid}
                        uid={uid}
                        name={resolvePersonName(uid, roster, team.captain)}
                        role="captain"
                        onOpenProfile={onOpenProfile}
                      />
                    ))
                  ) : (
                    <strong>未設定</strong>
                  )}
                </div>
              </div>
              <div class="td-v2-staff-row">
                <span class="td-v2-staff-label">領隊</span>
                <div class="td-v2-person-tags">
                  {leaderUids.length > 0 ? (
                    leaderUids.map((uid, idx) => (
                      <UserTag
                        key={uid}
                        uid={uid}
                        name={resolvePersonName(uid, roster, leaderNames[idx])}
                        role="team_leader"
                        onOpenProfile={onOpenProfile}
                      />
                    ))
                  ) : (
                    <strong>未設定</strong>
                  )}
                </div>
              </div>
              {coachUids.length > 0 ? (
                <div class="td-v2-staff-row td-v2-staff-row-wide" data-staff="coach">
                  <span class="td-v2-staff-label">{t('clubs.info.coach')}</span>
                  <div class="td-v2-person-tags">
                    {coachUids.map((uid, idx) => (
                      <UserTag
                        key={uid}
                        uid={uid}
                        name={resolvePersonName(uid, roster, coachNames[idx])}
                        role="coach"
                        onOpenProfile={onOpenProfile}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {contactText ? (
              <div class="td-v2-contact-card">
                <span class="td-v2-contact-label">聯繫方式</span>
                <div class="td-v2-contact-actions">
                  <span class="td-v2-contact-text">{contactText}</span>
                </div>
              </div>
            ) : null}
            {contactLinks.length > 0 ? (
              <div class="td-v2-contact-card" data-detail-field="social-links">
                <span class="td-v2-contact-label">{t('clubs.info.social')}</span>
                <div class="td-v2-social-list">
                  {contactLinks.map((link) => (
                    <a
                      key={link.url}
                      class="td-v2-social-btn"
                      data-platform={link.platform}
                      href={link.url}
                      rel="noopener noreferrer"
                      onClick={(event) => openHttpAnchor(event, link.url)}
                    >
                      <PlatformGlyph platform={link.platform} />
                      <span>{link.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* 熱門課程：B 沒有課程資料，不輸出 */}

        {showEvents && events.length > 0 && (
          <div class="td-v2-card">
            <div class="td-v2-section-head">
              <h3>近期活動</h3>
              <button
                type="button"
                data-td-v2-action="tab"
                data-tab="events"
                onClick={() => onSelectTab('events')}
              >
                全部
              </button>
            </div>
            {renderEventRows(events, 2, onSelectEvent)}
          </div>
        )}
      </section>

      {/* 課程：C1 先隱藏，課程上線（K3）後再開。 */}

      {/* 活動 */}
      {showEvents && (
        <section
          class={`td-v2-panel td-v2-panel-events${activeTab === 'events' ? ' active' : ''}`}
          data-panel="events"
        >
          <div class="td-v2-card">
            <div class="td-v2-section-head">
              <h3>本週行事曆</h3>
              <span>{`${events.length} 場活動`}</span>
            </div>
            <TeamDetailWeekStrip eventDays={eventDaySet} />
          </div>
          <div class="td-v2-card">
            <div class="td-v2-section-head">
              <h3>即將舉辦</h3>
              <span>{`${events.length} 場`}</span>
            </div>
            {eventsStatus === 'loading' ? (
              <div class="td-v2-empty">載入中…</div>
            ) : eventsStatus === 'error' ? (
              <div class="td-v2-empty" role="alert">
                <div>載入失敗</div>
                <button
                  type="button"
                  class="primary-btn small"
                  style="margin-top:8px"
                  onClick={onRetryEvents}
                >
                  重試
                </button>
              </div>
            ) : (
              renderEventRows(events, 8, onSelectEvent)
            )}
            {canCreateEvent && (
              <button
                class="td-v2-ghost"
                type="button"
                data-td-v2-action="create-event"
                onClick={onCreateEvent}
              >
                + 新增俱樂部活動
              </button>
            )}
          </div>
        </section>
      )}

      {/* 成員 */}
      {showMembers && (
        <section
          class={`td-v2-panel td-v2-panel-members${activeTab === 'members' ? ' active' : ''}`}
          data-panel="members"
        >
          <div class="td-v2-member-management">
            {membersStatus === 'loading' ? (
              <div class="td-v2-empty">載入中…</div>
            ) : membersStatus === 'error' ? (
              <div class="td-v2-empty" role="alert">
                <div>載入失敗</div>
                <button
                  type="button"
                  class="primary-btn small"
                  style="margin-top:8px"
                  onClick={onRetryMembers}
                >
                  重試
                </button>
              </div>
            ) : membersStatus === 'guest' ? (
              <div class="td-v2-empty">
                <div>登入後查看成員</div>
                <button
                  type="button"
                  class="primary-btn small"
                  style="margin-top:8px"
                  disabled={busy}
                  onClick={onLogin}
                >
                  登入
                </button>
              </div>
            ) : (
              <LegacyTeamMembersCard
                team={team}
                roster={roster}
                viewer={viewer}
                onTeamChanged={onTeamChanged}
                onOpenProfile={onOpenProfile}
                onMemberRemoved={onMemberRemoved}
              />
            )}
          </div>
        </section>
      )}

      {/* 戰績 */}
      {showRecord && (
        <section
          class={`td-v2-panel td-v2-panel-record${activeTab === 'record' ? ' active' : ''}`}
          data-panel="record"
        >
          <div class="td-v2-card">
            <div class="td-v2-section-head">
              <h3>俱樂部戰績</h3>
              <span>近況總覽</span>
            </div>
            <div class="td-v2-record-hero">
              <div class="td-v2-donut">
                <svg viewBox="0 0 110 110">
                  <circle cx="55" cy="55" r="46" />
                  <circle
                    cx="55"
                    cy="55"
                    r="46"
                    style={{ strokeDasharray: `${circle} 289` }}
                  />
                </svg>
                <div>
                  <strong>{totalGames > 0 ? `${winRate}%` : '-'}</strong>
                  <span>勝率</span>
                </div>
              </div>
              <div class="td-v2-record-list">
                {(
                  [
                    ['勝', wins, 'w'],
                    ['和', draws, 'd'],
                    ['負', losses, 'l'],
                  ] as const
                ).map(([label, val, cls]) => {
                  const pct = totalGames > 0 ? Math.round((val / totalGames) * 100) : 0;
                  return (
                    <div key={cls} class="td-v2-record-row">
                      <span class={cls}>{label}</span>
                      <div>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <strong>{val}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {/* 下一批補：俱樂部賽事列表 (_renderTeamTournaments) */}
        </section>
      )}

      {/* 動態：C1 沒有貼文就不出頁籤 */}
      {showFeed && (
      <section
        class={`td-v2-panel td-v2-panel-feed${activeTab === 'feed' ? ' active' : ''}`}
        data-panel="feed"
      >
          <div class="td-v2-card">
            <div class="td-v2-section-head">
              <h3>俱樂部動態</h3>
              <span>{`${feedPosts.length} 則`}</span>
            </div>
            {feedPosts.map((rawPost, idx) => {
              const post =
                rawPost && typeof rawPost === 'object'
                  ? (rawPost as Record<string, unknown>)
                  : {};
              const name = String(
                post['name'] || post['authorName'] || post['author'] || '俱樂部',
              );
              const text = String(post['text'] || post['body'] || post['content'] || '');
              const time = String(post['time'] || post['createdAtText'] || post['date'] || '');
              const initial = name.charAt(0) || '俱';
              return (
                <article key={idx} class="td-v2-post">
                  <div class="td-v2-post-head">
                    <span>{initial}</span>
                    <div>
                      <strong>{name}</strong>
                      <em>{time}</em>
                    </div>
                  </div>
                  <p>{text}</p>
                </article>
              );
            })}
          </div>
      </section>
      )}
    </main>
  );
}
