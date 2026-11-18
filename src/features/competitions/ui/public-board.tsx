// 詳情頁的公告與聯絡主辦。公告要進這頁才看得到。私訊沿用全站既有浮層。

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

function MsgIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

export function PublicBoard({
  ct,
  notices,
  contactNote,
  hostName,
  hostOps,
  busy,
  onPost,
  onDelete,
  onMessage,
}: {
  ct: CompetitionsT;
  notices: readonly CompetitionNotice[];
  contactNote: string | null;
  hostName: string;
  hostOps: boolean;
  busy: boolean;
  onPost: (text: string) => Promise<boolean>;
  onDelete: (noticeId: string) => Promise<void>;
  onMessage: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [showAll, setShowAll] = useState(false);
  const ordered = noticesNewestFirst(notices);
  const visible = showAll ? ordered : ordered.slice(0, NOTICE_PREVIEW_COUNT);
  const more = ordered.length > NOTICE_PREVIEW_COUNT && !showAll;
  const posted = hostNoticeCount(notices);
  const showNotices = ordered.length > 0 || hostOps;

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
      <CpCard>
        <h2 class="cpm-h">{ct('contactHost')}</h2>
        <div class="cpm-contact">
          <span class="cpm-host">{hostName}</span>
          <button type="button" class="cpm-pm" disabled={busy} onClick={() => { void onMessage(); }}>
            <MsgIcon />
            {ct('pmHost')}
          </button>
        </div>
        {contactNote ? <p class="cpm-public">{contactNote}</p> : null}
      </CpCard>
    </>
  );
}
