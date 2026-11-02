import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { t } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import { fetchUserSegmentPage, loadUserStatus, type UserSegment, type UserStatusLoad } from '../data/inactive-data';
import type { StatusUser } from '../data/inactive-model';
import { LoadMoreButton, LoadState } from './InactiveLists';

// 版面、文字與行內樣式照 A `user-admin-roles.js#_renderUserStatusCheck`／`#_renderUserStatusRow`。
// 站長 2026-11-02 裁定：頭像失效檢測（卡片與說明句）不做。
const CARD_BG = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px';
const STAT_BOX = 'flex:1;padding:10px 0;border-radius:8px;background:var(--bg-elevated)';
const AVATAR_BOX = 'width:32px;height:32px;border-radius:50%;background:var(--bg-elevated);align-items:center;justify-content:center;flex-shrink:0;font-size:14px;color:var(--text-muted)';

function UserRow(props: { user: StatusUser }): JSX.Element {
  const { user } = props;
  const [broken, setBroken] = useState(false);
  const showImg = Boolean(user.pictureUrl) && !broken;
  return (
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)" data-uid={user.uid}>
      {showImg ? (
        <img
          src={user.pictureUrl}
          alt=""
          style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg-elevated)"
          onError={() => setBroken(true)}
        />
      ) : (
        <div style={`${AVATAR_BOX};display:flex`}>👤</div>
      )}
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-size:.82rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          {user.name} <span style="font-weight:400;font-size:.72rem;color:var(--text-muted)">{user.roleLabel}</span>
        </div>
        <div style="font-size:.72rem;color:var(--text-muted)">最後登入：{user.lastLoginStr}（{user.daysSince} 天前）</div>
      </div>
    </div>
  );
}

function StatBox(props: { value: number; color: string; label: string }): JSX.Element {
  return (
    <div style={STAT_BOX}>
      <div style={`font-size:1.3rem;font-weight:700;color:${props.color}`}>{props.value}</div>
      <div style="font-size:.7rem;color:var(--text-muted)">{props.label}</div>
    </div>
  );
}

type Status = 'loading' | 'ready' | 'error';

export function UserStatusPanel(): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<UserStatusLoad | null>(null);
  const [busy, setBusy] = useState<UserSegment | null>(null);
  const [attempt, setAttempt] = useState(0);
  const seqRef = useRef(0);
  const nowRef = useRef(Date.now());

  useEffect(() => {
    const seq = ++seqRef.current;
    nowRef.current = Date.now();
    setStatus('loading');
    const run = async (): Promise<void> => {
      try {
        const next = await loadUserStatus(nowRef.current);
        if (seq !== seqRef.current) return;
        setData(next);
        setStatus('ready');
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[admin-inactive] user status load failed', err);
        if (seq !== seqRef.current) return;
        setStatus('error');
      }
    };
    void run();
    return () => { seqRef.current += 1; };
  }, [attempt]);

  if (status !== 'ready' || !data) {
    return <LoadState status={status === 'error' ? 'error' : 'loading'} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  const current = data;

  function hasMore(segment: UserSegment): boolean {
    const page = current[segment];
    return !page.done && page.items.length < current.listTotals[segment];
  }

  async function loadMore(segment: UserSegment): Promise<void> {
    if (busy || !hasMore(segment)) return;
    const seq = seqRef.current;
    setBusy(segment);
    try {
      const page = await fetchUserSegmentPage(segment, current[segment].cursor, nowRef.current);
      if (seq !== seqRef.current) return;
      setData((prev) => (prev ? {
        ...prev,
        [segment]: { items: [...prev[segment].items, ...page.items], cursor: page.cursor, done: page.done },
      } : prev));
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[admin-inactive] user status load more failed', err);
      if (seq === seqRef.current) toast.show({ message: t('admin-inactive.loadError'), tone: 'error' });
    } finally {
      if (seq === seqRef.current) setBusy(null);
    }
  }

  function section(segment: UserSegment, title: string, color: string): JSX.Element | null {
    // 標題人數用名單查得到的人數（統計框的「超過 90 天」另含從未登入等列不出的帳號）。
    const count = current.listTotals[segment];
    if (count <= 0) return null;
    return (
      <div style={CARD_BG} data-segment={segment}>
        <div style={`font-size:.88rem;font-weight:700;color:${color};margin-bottom:8px`}>{title}（{count} 人）</div>
        {current[segment].items.map((user) => <UserRow key={user.id} user={user} />)}
        {hasMore(segment) ? (
          <LoadMoreButton busy={busy !== null} onClick={() => { void loadMore(segment); }} />
        ) : null}
      </div>
    );
  }

  const { stats } = current;
  return (
    <>
      <div style={CARD_BG}>
        <div style="font-size:.88rem;font-weight:700;color:var(--text-primary);margin-bottom:10px">用戶登入統計</div>
        <div style="display:flex;gap:8px;text-align:center">
          <StatBox value={stats.active} color="var(--success)" label="30 天內活躍" />
          <StatBox value={stats.mid} color="var(--warning)" label="30~90 天未登入" />
          <StatBox value={stats.over90} color="var(--danger)" label="超過 90 天" />
        </div>
      </div>
      {section('over90', '超過 90 天未登入', 'var(--danger)')}
      {section('mid', '30~90 天未登入', 'var(--warning)')}
      {stats.over90 === 0 && stats.mid === 0 ? (
        <div style="text-align:center;padding:1.5rem;color:var(--text-muted)">所有用戶都在 30 天內有登入記錄</div>
      ) : null}
    </>
  );
}
