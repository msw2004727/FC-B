// D. 檢錄列印、稽核、跨午夜賽程。檢錄真名只給主辦，或該隊代表。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import {
  S4B_AUDIT,
  S4B_MIDNIGHT_IDS,
  S4B_PLAYERS,
  auditNewestFirst,
  canSeeRealName,
  formatMdHm,
  groupMatches,
  matchById,
  playersByTeam,
  weekdayIndex,
  type CheckinViewer,
} from '../testing/step4b-fixtures';
import { auditActionLabel, auditActorLabel, copy, matchStatusLabel, posLabel, weekdayName } from './copy';
import { Line, MatchBits, S4bCard, S4bFrame, vsLabel } from './ui';

// 漏傳視角時用 other，漏傳代表隊伍時不給真名。預覽的 checkin-print 會明確傳 host。
export function CheckinPrintScreen({
  viewer = 'other',
  repTeamId = null,
}: {
  viewer?: CheckinViewer;
  repTeamId?: string | null;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const teams = playersByTeam(S4B_PLAYERS);
  function sheetText(): string {
    const lines: string[] = [];
    for (const team of teams) {
      const showReal = canSeeRealName(viewer, team.teamId, repTeamId);
      lines.push(team.teamName);
      for (const player of team.players) {
        const real = showReal ? player.realName : '';
        lines.push(`${player.number} ${real} ${player.displayName} ${posLabel[player.position]}`);
      }
    }
    return lines.join('\n');
  }
  async function copySheet(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(sheetText());
    } catch {
      // 預覽不因剪貼簿失敗改畫面。
    }
    setCopied(true);
  }
  return (
    <S4bFrame title={copy.checkinTitle} admin screen="checkin-print">
      <div class="s4b-pair s4b-noprint">
        <Button variant="secondary" onClick={() => window.print()}>{copy.print}</Button>
        <Button variant="secondary" onClick={() => { void copySheet(); }}>{copied ? copy.copied : copy.copyText}</Button>
      </div>
      {teams.map((team) => {
        const showReal = canSeeRealName(viewer, team.teamId, repTeamId);
        return (
          <S4bCard key={team.teamId} plain>
            <h2 class="s4b-h">{team.teamName}</h2>
            <table class="s4b-table">
              <thead>
                <tr>
                  <th>{copy.colNumber}</th>
                  {showReal ? <th>{copy.colReal}</th> : null}
                  <th>{copy.colDisplay}</th>
                  <th>{copy.colPos}</th>
                  <th>{copy.colSign}</th>
                </tr>
              </thead>
              <tbody>
                {team.players.map((player) => (
                  <tr key={player.id} data-player={player.id} data-team={team.teamId}>
                    <td>{player.number}</td>
                    {showReal ? <td>{player.realName}</td> : null}
                    <td>{player.displayName}</td>
                    <td>{posLabel[player.position]}</td>
                    <td><span class="s4b-sign" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </S4bCard>
        );
      })}
    </S4bFrame>
  );
}

export function AuditLogScreen(): JSX.Element {
  const rows = auditNewestFirst(S4B_AUDIT);
  return (
    <S4bFrame title={copy.auditTitle} admin screen="audit-log">
      <S4bCard plain>
        <ul class="cps-list">
          {rows.map((row) => (
            <li key={row.id} class="s4b-li">
              <div class="s4b-gap" style="width:100%">
                <div class="s4b-m__top">
                  <span class="s4b-k">{formatMdHm(row.at)}</span>
                  <Badge tone={row.action === 'score' ? 'warning' : 'neutral'} size="sm" label={auditActionLabel[row.action]} />
                </div>
                <Line text={copy.kv(copy.actor, auditActorLabel[row.actorRole])} />
                <Line text={row.target} />
                <Line text={row.reason} />
                {row.before && row.after ? (
                  <div class="s4b-m__top">
                    <span class="s4b-k">{copy.scoreBefore(row.before)}</span>
                    <span class="s4b-k">{copy.scoreAfter(row.after)}</span>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </S4bCard>
    </S4bFrame>
  );
}

export function ScheduleMidnightScreen(): JSX.Element {
  const matches = S4B_MIDNIGHT_IDS.map((id) => matchById(id)).filter((match) => match != null);
  const groups = groupMatches(matches);
  return (
    <S4bFrame title={copy.scheduleTitle} screen="schedule-midnight">
      <S4bCard>
        {groups.map((group) => (
          <div key={group.key}>
            <p class="s4b-day">{copy.dayHeading(group.month, group.day, weekdayName[weekdayIndex(group.key) ?? 0] ?? '')}</p>
            {group.matches.map((match) => (
              <div key={match.id} class="s4b-m">
                <div class="s4b-m__top">
                  <MatchBits match={match} />
                  <Badge tone="neutral" size="sm" label={matchStatusLabel[match.status]} />
                </div>
                <Line text={vsLabel(match)} />
              </div>
            ))}
          </div>
        ))}
      </S4bCard>
    </S4bFrame>
  );
}
