// 邀請記分員（K11）。主辦或共同主辦選角色與場次 → createInvite → 顯示連結（只顯示這一次）。
// 連結格式見 data/invite-link.ts（代碼放 # 之後，不放查詢字串）。代碼只留在這一頁的記憶體，不寫進 log、toast 或儲存。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { openExternal } from '@/core/open-external';
import { PageSpinner } from '@/ui/PageSpinner';
import { toast } from '@/ui/Toast';
import { canHostOrCo, isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import { buildInviteUrl } from '../data/invite-link';
import type { ScoreRole } from '../data/staff-assign';
import type { CompetitionDoc, MatchDoc } from '../data/types';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { formatTaipeiShort } from '../format';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { InviteLinkCard, StaffAssignScreen, StaffDeniedScreen } from '../step4b/staff';
import { S4bFrame } from '../step4b/ui';
import { errorOf, reasonText } from '../ui/feedback';
import { CpI18nPending } from '../ui/shell';
import { assignDays } from './StaffAssignPage';

/** 剪貼簿 API 不能用時退回 textarea。 */
export async function copyInviteText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    try {
      ta.select();
      return Boolean(document.execCommand?.('copy'));
    } finally {
      ta.remove();
    }
  } catch {
    return false;
  }
}

export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

export function inviteRoleText(ct: CompetitionsT, roles: readonly string[]): string {
  const scorer = roles.includes('scorer');
  const referee = roles.includes('referee');
  if (scorer && referee) return ct('inviteRoleBoth');
  return referee ? ct('roleReferee') : ct('roleScorer');
}

interface Created {
  url: string;
  role: ScoreRole;
  expiresAt: number;
}

function StaffInviteView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready' | 'error'>('loading');
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [venues, setVenues] = useState<CompetitionDoc['venues']>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [role, setRole] = useState<ScoreRole>('scorer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    if (env.actor.authPending) return undefined;
    let alive = true;
    setPhase('loading');
    void (async () => {
      const uid = env.actor.uid;
      if (!uid) {
        if (alive) setPhase('denied');
        return;
      }
      const staff = await env.repo.getStaff(cid, uid);
      if (!alive) return;
      if (!canHostOrCo({ staffRoles: staff?.roles ?? [], isAdmin: isCpAdmin(env.actor.role) })) {
        setPhase('denied');
        return;
      }
      const matchList = await env.repo.listMatches(cid);
      if (!alive) return;
      const needVenue = matchList.some((match) => !match.venueName && match.venueIdx != null);
      const competition = needVenue ? await env.repo.getCompetition(cid) : null;
      if (!alive) return;
      setVenues(competition?.venues ?? []);
      setMatches(matchList);
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
  }, [cid, env.actor.authPending, env.actor.role, env.actor.uid, env.repo]);

  async function submit(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError('');
    const order = assignDays(ct, matches, venues).flatMap((group) => group.matches.map((match) => match.id));
    const matchIds = order.filter((id) => picked.has(id));
    try {
      const create = env.actions.createInvite;
      const result = await create({ cid, roles: [role], matchIds });
      const origin = typeof window === 'undefined' ? '' : window.location.origin;
      setCreated({ url: buildInviteUrl(origin, cid, result.ivId, result.code), role, expiresAt: result.expiresAt });
    } catch (err) {
      const info = errorOf(err);
      setError(reasonText(ct, info.reason, info.params));
    } finally {
      setSaving(false);
    }
  }

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}/staff`);
  if (env.actor.authPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'denied' || phase === 'error' || !env.actor.uid) {
    return (
      <StaffDeniedScreen
        title={ct('staffInvite')}
        message={phase === 'error' ? ct('loadFailed') : ct('staffNoPermission')}
        backLabel={ct('backToCompetition')}
        onBack={() => route(`/competitions/${cid}`)}
      />
    );
  }
  if (created) {
    const url = created.url;
    return (
      <S4bFrame title={ct('staffInvite')} admin screen="staff-invite-link" onBack={back}>
        <InviteLinkCard
          title={ct('inviteLinkTitle')}
          url={url}
          once={ct('inviteOnce')}
          roleLine={`${ct('staffRole')}：${inviteRoleText(ct, [created.role])}`}
          expiresLine={ct('inviteExpires', { date: formatTaipeiShort(created.expiresAt) })}
          copyLabel={ct('inviteCopy')}
          shareLabel={ct('inviteShareLine')}
          onCopy={() => {
            void copyInviteText(url).then((ok) => {
              toast.show({ message: ok ? ct('inviteCopied') : ct('inviteCopyFailed'), tone: ok ? 'success' : 'error' });
            });
          }}
          onShare={() => openExternal(lineShareUrl(`${ct('inviteShareText')}\n${url}`))}
        />
      </S4bFrame>
    );
  }
  return (
    <StaffAssignScreen
      title={ct('staffInvite')}
      screen="staff-invite-form"
      showPerson={false}
      days={assignDays(ct, matches, venues)}
      picked={picked}
      onToggle={(id, on) => {
        setPicked((prev) => {
          const next = new Set(prev);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        });
      }}
      role={role}
      onRole={setRole}
      roleLabel={ct('staffRole')}
      scorerLabel={ct('roleScorer')}
      refereeLabel={ct('roleReferee')}
      saveLabel={ct('inviteCreate')}
      saving={saving}
      error={error}
      onSave={() => { void submit(); }}
      onBack={back}
    />
  );
}

export default function StaffInvitePage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <StaffInviteView env={injected} cid={cid} />;
  return (
    <LiveBoundary loadClubs={false}>
      {(actor, repo) => <StaffInviteView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
