// 詳情頁「分享賽事」鈕（CP-SHARE）。生命週期照活動詳情 EventDetailToolbarActions：
// 本鈕自己的 AbortController，離開頁面就中止；ref 鎖防連點（shareCompetition 另有模組鎖）。
// 顯示條件由呼叫端用 isCompetitionShareable 判斷；這裡再擋一次，不合格不畫。

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { toast } from '@/ui/Toast';
import type { CompetitionsT } from '../i18n';
import { isCompetitionShareable, shareCompetition, type ShareCompetition } from '../data/competition-share';

function ShareIcon(): JSX.Element {
  return (
    <svg class="cps-ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </svg>
  );
}

export function ShareCompetitionButton({
  ct,
  competition,
  loggedIn,
}: {
  ct: CompetitionsT;
  competition: ShareCompetition;
  loggedIn: boolean;
}): JSX.Element | null {
  const alive = useRef(true);
  const controller = useRef(new AbortController());
  const sharing = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current.abort();
    };
  }, []);

  if (!isCompetitionShareable(competition)) return null;

  async function share(): Promise<void> {
    if (sharing.current || !alive.current) return;
    sharing.current = true;
    try {
      await shareCompetition(competition, {
        ct,
        loggedIn,
        signal: controller.current.signal,
        showToast: (message) => {
          if (alive.current) toast.show({ message });
        },
      });
    } catch {
      if (alive.current) toast.show({ message: ct('shareFailed') });
    } finally {
      sharing.current = false;
    }
  }

  return (
    <Button variant="secondary" leading={<ShareIcon />} onClick={() => { void share(); }}>
      {ct('shareBtn')}
    </Button>
  );
}
