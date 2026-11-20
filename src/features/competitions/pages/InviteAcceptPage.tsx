// 接受記分邀請（K11）。網址 /competitions/:cid/invite#i=<ivId>&c=<code>（顧問裁定：代碼不放查詢字串）。
// 進頁讀到 # 立刻 replaceState 拿掉。未登入者按「登入」時才暫存到 sessionStorage（LINE 登入回跳帶不了 #）。
// 成功、任何錯誤、離開頁面都清掉 sessionStorage 暫存。代碼不寫進 console、toast、錯誤訊息或任何回報。
// 顧問 11-20：連線或不明錯誤時記憶體裡的邀請保留（可直接再按一次）；伺服器明確回無效／已使用／已撤銷／已過期才整個清掉。

/** 伺服器明確判定這張邀請不能再用的錯誤碼：清掉記憶體裡的邀請。其他（連線、不明、賽事狀態）保留讓本人可再按。 */
const FINAL_INVITE_REASONS = new Set(['INVITE_INVALID', 'INVITE_USED', 'INVITE_REVOKED', 'INVITE_EXPIRED']);

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { toast } from '@/ui/Toast';
import { liveCpActions } from '../actions';
import {
  clearInviteTicket,
  parseInviteHash,
  readInviteTicket,
  saveInviteTicket,
  stripLocationHash,
  type InviteTicket,
} from '../data/invite-link';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { cpSignIn } from '../sign-in';
import { S4bCard, S4bFrame } from '../step4b/ui';
import { errorOf, reasonText } from '../ui/feedback';
import { CpI18nPending } from '../ui/shell';

/** 接受頁的錯誤句子。結束、取消改用邀請語氣，其他沿用 reasons。 */
export function acceptErrorText(ct: CompetitionsT, reason: string, params?: Record<string, unknown>): string {
  if (reason === 'COMPETITION_ENDED') return ct('acceptEnded');
  if (reason === 'COMPETITION_CLOSED') return ct('acceptClosed');
  return reasonText(ct, reason, params);
}

/**
 * 進頁只做一次：# 優先，其次 sessionStorage（登入回來）。有 # 一律從網址列拿掉（格式錯也拿掉）。
 * 讀到 # 只留在記憶體；只有按「登入」才寫 sessionStorage（Opus 審 P3-1：已登入者整頁離開不會留暫存）。
 */
function takeTicket(cid: string): { ticket: InviteTicket | null; badLink: boolean } {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const parsed = parseInviteHash(hash);
  if (hash) stripLocationHash();
  if (parsed && cid) return { ticket: { cid, ivId: parsed.ivId, code: parsed.code }, badLink: false };
  const stored = cid ? readInviteTicket(cid) : null;
  // 網址帶了 # 但格式不對＝連結無效；沒有 # 也沒有暫存（換瀏覽器、LINE 登入回來暫存不見）＝找不到邀請資料（顧問 11-20）。
  return { ticket: stored, badLink: !stored && hash.length > 1 };
}

function InviteAcceptView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  // useState 的初始函式只跑一次：同一次掛載不會重讀 #。
  const [initial] = useState(() => takeTicket(cid));
  const [ticket, setTicket] = useState<InviteTicket | null>(initial.ticket);
  const [badLink, setBadLink] = useState(initial.badLink);
  const [compName, setCompName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 進頁就沒有邀請時的句子在畫面上依 initial 決定（字典可能還沒載入，不在這裡先算）。
  const [message, setMessage] = useState<string | null>(null);
  const loginLock = useRef(false);

  // 已停在接受頁時，同分頁重新點開邀請連結只會換 #、不會重新載入（顧問 11-20 staging）：
  // # 一變就重新讀取、立刻拿掉、更新畫面。格式錯的 # 也拿掉並顯示連結無效。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHash = () => {
      const hash = window.location.hash;
      if (!hash || hash === '#') return;
      const parsed = parseInviteHash(hash);
      stripLocationHash();
      setMessage(null);
      if (parsed && cid) {
        setTicket({ cid, ivId: parsed.ivId, code: parsed.code });
        setBadLink(false);
      } else {
        setTicket(null);
        setBadLink(true);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [cid]);

  // 離開頁面（含 SPA 換頁）清掉暫存。整頁導去 LINE 登入不會卸載，暫存留著讓回來接續。
  useEffect(() => () => {
    clearInviteTicket();
  }, []);

  useEffect(() => {
    if (!ticket || env.actor.authPending || !env.actor.uid) return undefined;
    let alive = true;
    // 賽事名稱讀得到才顯示（下架、內部賽事讀不到就不顯示）。失敗不影響接受。
    void env.repo.getCompetition(cid).then((doc) => {
      if (alive) setCompName(doc?.name ?? null);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [cid, env.actor.authPending, env.actor.uid, env.repo, ticket]);

  async function accept(): Promise<void> {
    if (!ticket || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const run = env.actions.acceptInvite;
      await run({ cid: ticket.cid, ivId: ticket.ivId, code: ticket.code });
      clearInviteTicket();
      setTicket(null);
      toast.show({ message: ct('acceptDone'), tone: 'success' });
      route(`/competitions/${cid}/my-matches`);
    } catch (err) {
      // 錯誤句子只來自 reason 代碼，不帶 err.message、不帶代碼。
      const info = errorOf(err);
      clearInviteTicket();
      if (FINAL_INVITE_REASONS.has(info.reason)) setTicket(null);
      setMessage(acceptErrorText(ct, info.reason, info.params));
    } finally {
      setBusy(false);
    }
  }

  async function login(): Promise<void> {
    if (loginLock.current) return;
    loginLock.current = true;
    try {
      if (ticket) saveInviteTicket(ticket);
      await (env.signIn ?? cpSignIn)();
    } catch {
      toast.show({ message: reasonText(ct, 'UNKNOWN'), tone: 'error' });
    } finally {
      loginLock.current = false;
    }
  }

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}`);
  if (env.actor.authPending) return <div class="cps-root"><PageSpinner /></div>;
  if (!ticket) {
    return (
      <S4bFrame title={ct('acceptTitle')} screen="invite-accept-invalid" onBack={back}>
        <S4bCard>
          <p class="s4b-alert" role="alert">
            {message || (badLink ? reasonText(ct, 'INVITE_INVALID') : ct('acceptNoTicket'))}
          </p>
        </S4bCard>
      </S4bFrame>
    );
  }
  if (!env.actor.uid) {
    return (
      <S4bFrame title={ct('acceptTitle')} screen="invite-accept-login" onBack={back}>
        <S4bCard>
          <div class="s4b-gap">
            <p class="s4b-line"><span class="s4b-k">{ct('acceptLogin')}</span></p>
            <div class="s4b-blockbtn">
              <Button variant="primary" onClick={() => { void login(); }}>{ct('acceptLoginButton')}</Button>
            </div>
          </div>
        </S4bCard>
      </S4bFrame>
    );
  }
  return (
    <S4bFrame title={ct('acceptTitle')} screen="invite-accept" onBack={back}>
      <S4bCard>
        <div class="s4b-gap">
          {compName ? <h2 class="s4b-h s4b-accept__name">{compName}</h2> : null}
          {/* 蒐集顯示名稱的當下告知本人（顧問 11-20，隱私權條文「記分員與裁判」） */}
          <p class="s4b-line s4b-accept__notice">{ct('acceptNotice')}</p>
          {message ? <p class="s4b-alert" role="alert">{message}</p> : null}
          <div class="s4b-blockbtn">
            <Button variant="primary" loading={busy} disabled={busy} onClick={() => { void accept(); }}>
              {ct('acceptButton')}
            </Button>
          </div>
        </div>
      </S4bCard>
    </S4bFrame>
  );
}

export default function InviteAcceptPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <InviteAcceptView env={injected} cid={cid} />;
  return (
    <LiveBoundary loadClubs={false}>
      {(actor, repo) => <InviteAcceptView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
