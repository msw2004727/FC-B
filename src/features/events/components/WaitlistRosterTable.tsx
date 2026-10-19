/**
 * 活動詳情「候補名單」唯讀檢視元件。
 *
 * 對照舊版 A `event-detail.js#_renderGroupedWaitlistSection` 與 `event-manage-waitlist.js#_renderWaitlistSection`（非編輯模式表格）。
 *
 * 本批不做（之後的批次補）：
 * - 編輯模式（「正取」升正取按鈕）
 * - 以名字比對或重排（R-ID-002 刻意不移植）
 */

import type { JSX } from 'preact';
import { Fragment } from 'preact';
import { UserTag } from '@/ui/UserTag';
import type { UserRole } from '@/ui/Avatar';
import {
  buildWaitlistRoster,
  type RosterEventInput,
  type RosterRegistrationInput,
} from '../data/attendance-roster-model';

export interface WaitlistRosterTableProps {
  event: RosterEventInput;
  registrations: readonly RosterRegistrationInput[];
  roles: Readonly<Record<string, UserRole>>;
  onOpenProfile: (uid: string) => void;
}

export function WaitlistRosterTable({
  event,
  registrations,
  roles,
  onOpenProfile,
}: WaitlistRosterTableProps): JSX.Element | null {
  const { items, totalCount } = buildWaitlistRoster(event, registrations);

  // 對照 A：if (items.length === 0) { container.innerHTML = ''; return; }
  if (items.length === 0) return null;

  return (
    <div class="detail-section">
      <div
        class="detail-section-title"
        style="display:flex;align-items:center;gap:.5rem"
      >
        <span>{`候補名單（${totalCount}）`}</span>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.8rem">
          <thead>
            <tr style="border-bottom:2px solid var(--border)">
              <th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:2rem">#</th>
              <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const rowKey = `${item.registrationId || item.userId || item.name}:${idx}`;
              return (
                <Fragment key={rowKey}>
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:.35rem .3rem;text-align:center;width:2rem">
                      <span class="wl-pos">{idx + 1}</span>
                    </td>
                    <td style="padding:.35rem .3rem;text-align:left">
                      <UserTag
                        uid={item.userId}
                        name={item.name}
                        role={roles[item.userId]}
                        disabled={!item.userId}
                        onOpenProfile={onOpenProfile}
                      />
                    </td>
                  </tr>
                  {item.selfOrphanInfo ? (
                    <tr style="border-bottom:1px solid var(--border)">
                      <td />
                      <td
                        style="padding:.1rem .3rem .1rem 1.8rem;font-size:.72rem;color:var(--text-muted)"
                        data-no-translate
                      >
                        {`↳ 報名人：${item.selfOrphanInfo}（`}
                        <span style="color:var(--success)">已正取</span>
                        {'）'}
                      </td>
                    </tr>
                  ) : null}
                  {item.companions.map((c, cIdx) => (
                    <Fragment key={`${rowKey}:comp:${c.companionId || cIdx}`}>
                      <tr style="border-bottom:1px solid var(--border)">
                        <td />
                        <td
                          style="padding:.3rem .3rem;text-align:left;padding-left:1.2rem"
                          data-no-translate
                        >
                          <span style="color:var(--text-secondary)">{`↳ ${c.name}`}</span>
                        </td>
                      </tr>
                      {c.orphanInfo ? (
                        <tr style="border-bottom:1px solid var(--border)">
                          <td />
                          <td
                            style="padding:.1rem .3rem .1rem 2.4rem;font-size:.72rem;color:var(--text-muted)"
                            data-no-translate
                          >
                            {`↳ 報名人：${c.orphanInfo}（`}
                            <span style="color:var(--success)">已正取</span>
                            {'）'}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
