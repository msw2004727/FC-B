import type { JSX } from 'preact';
import { DetailAttendanceSummary } from './DetailAttendanceSummary';
import {
  guestEventPeople,
  type DetailEvent,
  type GuestEventPerson,
} from '../../data/detail-model';

export interface GuestRosterSectionsProps {
  event: DetailEvent;
  eventId: string;
  expanded: boolean;
  onExpand: () => void;
  onOpenProfile: (uid: string) => void;
  max: number;
  confirmedCount: number;
  waitlistCount: number;
}

function GuestCapsuleList({
  people,
  onOpenProfile,
}: {
  people: readonly GuestEventPerson[];
  onOpenProfile: (uid: string) => void;
}): JSX.Element {
  return (
    <div style="display:flex;flex-wrap:wrap;gap:.4rem">
      {people.map((person, index) => (
        <span
          key={`${person.uid}:${index}`}
          class="user-capsule uc-user"
          onClick={() => {
            if (person.uid) onOpenProfile(person.uid);
          }}
        >
          {' '}
          {person.name}
        </span>
      ))}
    </div>
  );
}

/**
 * 照舊版 A `event-detail.js#_renderGuestAttendanceTable`（第 978～1003 行）
 * 與 `_renderGuestWaitlistSection`（第 1005～1025 行）。
 */
export function GuestRosterSections({
  event,
  eventId,
  expanded,
  onExpand,
  onOpenProfile,
  max,
  confirmedCount,
  waitlistCount,
}: GuestRosterSectionsProps): JSX.Element {
  const confirmedPeople = guestEventPeople(event, 'participants');
  const waitlistPeople = guestEventPeople(event, 'waitlistNames');

  return (
    <>
      <div class="detail-section">
        <div id="detail-attendance-table">
          {!expanded ? (
            <DetailAttendanceSummary
              eventId={eventId}
              confirmedCount={confirmedCount}
              waitlistCount={waitlistCount}
              max={max}
              canManage={false}
              canViewRecords={false}
              onOpen={onExpand}
            />
          ) : confirmedPeople.length === 0 ? (
            <div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">
              尚無報名
            </div>
          ) : (
            <GuestCapsuleList people={confirmedPeople} onOpenProfile={onOpenProfile} />
          )}
        </div>
      </div>
      <div class="detail-section" id="detail-unreg-section" style="display:none">
        <div id="detail-unreg-table" />
      </div>
      <div id="detail-waitlist-container">
        {/* 照 A：訪客候補區不受摘要卡影響，進頁即顯示（_renderGuestWaitlistSection 無 on-demand 判斷）*/}
        {waitlistPeople.length > 0 && (
          <div class="detail-section">
            <div class="detail-section-title">
              {`候補名單 (${waitlistPeople.length})`}
            </div>
            <GuestCapsuleList people={waitlistPeople} onOpenProfile={onOpenProfile} />
          </div>
        )}
      </div>
    </>
  );
}
