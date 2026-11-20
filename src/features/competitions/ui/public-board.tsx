// 詳情頁的公告與聯絡主辦。公告要進這頁才看得到。
// 俱樂部主辦連到既有俱樂部頁。個人主辦只顯示公開聯絡文字，不開站內私訊。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Textarea';
import { clipCodePoints } from '../format';
import {
  HOST_NOTICE_MAX,
  NOTICE_PREVIEW_COUNT,
  hostNoticeCount,
  noticeWhen,
  noticesNewestFirst,
} from '../data/flex-schedule';
import type { CompetitionNotice } from '../data/types';
import type { CompetitionsT } from '../i18n';
import { CpCard } from './shell';

/** 俱樂部頁既有路由。id 照路徑編碼，避免斜線被當成下一層。 */
export function clubPagePath(teamId: string): string {
  return `/teams/${encodeURIComponent(teamId)}`;
}

export function PublicBoard({
  ct,
  notices,
  contactNote,
  hostName,
  hostOps,
  busy,
  clubTeamId,
  onOpenClub,
  onPost,
  onDelete,
}: {
  ct: CompetitionsT;
  notices: readonly CompetitionNotice[];
  contactNote: string | null;
  hostName: string;
  hostOps: boolean;
  busy: boolean;
  /** 俱樂部主辦且有 hostTeamId 才有值。沒有就不顯示連到俱樂部的連結。 */
  clubTeamId: string | null;
  onOpenClub: (teamId: string) => void;
  onPost: (text: string) => Promise<boolean>;
  onDelete: (noticeId: string) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [showAll, setShowAll] = useState(false);
  const ordered = noticesNewestFirst(notices);
  const visible = showAll ? ordered : ordered.slice(0, NOTICE_PREVIEW_COUNT);
  const more = ordered.length > NOTICE_PREVIEW_COUNT && !showAll;
  const posted = hostNoticeCount(notices);
  const showNotices = ordered.length > 0 || hostOps;
  const clubPath = clubTeamId ? clubPagePath(clubTeamId) : null;
  // 個人主辦沒有公開文字時，整區不顯示。俱樂部主辦一定留連結（聯絡方式在俱樂部頁）。
  const showContact = clubPath != null || contactNote != null;

  async function publish(): Promise<void> {
    const ok = await onPost(draft);
    if (ok) setDraft('');
  }

  return (
    <>
      {showNotices ? (
        <CpCard>
          <h2 class="cpm-h">{ct('announce')}</h2>
          {visible.length > 0 ? (
            <ul class="cpm-ann">
              {visible.map((notice) => (
                <li key={notice.id}>
                  <div class="cpm-ann__row">
                    {notice.kind === 'system' ? <Badge tone="neutral" label={ct('system')} size="sm" /> : null}
                    <span class="cpm-ann__txt">{notice.text}</span>
                    {hostOps ? (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void onDelete(notice.id); }}>
                        {ct('noticeDelete')}
                      </Button>
                    ) : null}
                  </div>
                  <span class="cpm-ann__time">{noticeWhen(notice.at)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {more ? (
            <button type="button" class="cp3-textlink" onClick={() => setShowAll(true)}>{ct('more')}</button>
          ) : null}
          {hostOps ? (
            <>
              <Textarea
                label={ct('annLabel')}
                hint={ct('annLimit')}
                value={draft}
                maxLength={300}
                rows={3}
                disabled={busy}
                onValueChange={(value) => setDraft(clipCodePoints(value, 300))}
              />
              <div class="cpm-ann__foot">
                <span class="cpm-meta">{ct('posted', { n: posted, max: HOST_NOTICE_MAX })}</span>
                <Button
                  variant="primary"
                  disabled={busy || posted >= HOST_NOTICE_MAX || draft.trim() === ''}
                  onClick={() => { void publish(); }}
                >
                  {ct('publishNotice')}
                </Button>
              </div>
            </>
          ) : null}
        </CpCard>
      ) : null}
      {showContact ? (
        <CpCard>
          <h2 class="cpm-h">{ct('contactHost')}</h2>
          {clubPath && clubTeamId ? (
            <div class="cpm-contact">
              {hostName ? <span class="cpm-host">{hostName}</span> : null}
              <a
                class="cpm-pm"
                href={clubPath}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenClub(clubTeamId);
                }}
              >
                {ct('contactHost')}
              </a>
            </div>
          ) : null}
          {contactNote ? <p class="cpm-public">{contactNote}</p> : null}
        </CpCard>
      ) : null}
    </>
  );
}
