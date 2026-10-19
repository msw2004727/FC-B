/**
 * 活動詳情「候補名單」唯讀檢視元件。
 *
 * 對照舊版 A `event-manage-waitlist.js#_renderWaitlistSection`（`tableEditing === false`）。
 *
 * 本批不做（之後的批次補）：
 * - 編輯模式（「正取」升正取按鈕）
 * - 以名字比對或重排（R-ID-002 刻意不移植）
 */

import './attendance-roster.css';
import type { JSX } from 'preact';
import { Fragment } from 'preact';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
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
  const t = useT();
  const { items, totalCount } = buildWaitlistRoster(event, registrations);

  // 對照 A：if (items.length === 0) { container.innerHTML = ''; return; }
  if (items.length === 0) return null;

  return (
    <div>
      <div class="wl-roster-header">
        <Text>{t('events.roster.waitlistTitle', { count: totalCount })}</Text>
      </div>
      <div class="att-roster-scroll">
        <table class="wl-roster-table">
          <thead>
            <tr class="att-roster-thead-row">
              <th class="wl-roster-th-pos"><Text>{t('events.roster.waitlistNumber')}</Text></th>
              <th class="wl-roster-th-name"><Text>{t('events.roster.waitlistName')}</Text></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const rowKey = `${item.registrationId || item.userId || item.name}:${idx}`;
              return (
                <Fragment key={rowKey}>
                  <tr class="att-roster-row">
                    <td class="wl-roster-td-pos">
                      <span class="wl-pos"><Text>{String(idx + 1)}</Text></span>
                    </td>
                    <td class="wl-roster-td-name">
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
                    <tr>
                      <td />
                      <td class="wl-roster-orphan-cell" data-no-translate>
                        <Text>{t('events.roster.orphanPrefix', { name: item.selfOrphanInfo })}</Text>
                        <span class="wl-roster-orphan-confirmed">
                          <Text>{t('events.roster.orphanConfirmed')}</Text>
                        </span>
                        <Text>{t('events.roster.orphanSuffix')}</Text>
                      </td>
                    </tr>
                  ) : null}
                  {item.companions.map((c, cIdx) => (
                    <Fragment key={`${rowKey}:comp:${c.companionId || cIdx}`}>
                      <tr class="att-roster-row">
                        <td class="wl-roster-td-companion-empty" />
                        <td class="wl-roster-td-companion" data-no-translate>
                          <Text>{`↳ ${c.name}`}</Text>
                        </td>
                      </tr>
                      {c.orphanInfo ? (
                        <tr>
                          <td />
                          <td class="wl-roster-orphan-cell--companion" data-no-translate>
                            <Text>{t('events.roster.orphanPrefix', { name: c.orphanInfo })}</Text>
                            <span class="wl-roster-orphan-confirmed">
                              <Text>{t('events.roster.orphanConfirmed')}</Text>
                            </span>
                            <Text>{t('events.roster.orphanSuffix')}</Text>
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
