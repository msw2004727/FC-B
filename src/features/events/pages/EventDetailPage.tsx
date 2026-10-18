import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { BottomSheet } from '@/ui/BottomSheet';
import { Checkbox } from '@/ui/Checkbox';
import { DateTime } from '@/ui/DateTime';
import { UserTag } from '@/ui/UserTag';
import { Toast } from '@/ui/Toast';
import { useViewer } from '@/features/profile/data/viewer';
import { loadEventDetail, loadEventRegistrations } from '../data/event-detail';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { isEventVisibleToUser } from '../data/visibility';
import { precheckSignup, cancelRegistration, SignupError } from '../data/signup';
import { registerSelection } from '../data/signup-selection';
import { loadSignupCompanions, type SignupCompanion } from '../data/companions';
import { getSignupButtonState } from '../data/signup-state';
import {
  count,
  eventDateRange,
  isActiveRegistration,
  isCompanion,
  registrationId,
  registrationOwner,
  safeImageUrl,
  sortRegistrations,
  type DetailEvent,
  type DetailRegistration,
} from '../data/detail-model';
import type { RegistrationDoc } from '../data/types';
import './event-detail.css';

interface Snapshot {
  event: DetailEvent;
  eventDocId: string;
  viewerRegistrations: RegistrationDoc[];
  registrations: DetailRegistration[];
}

interface Notice {
  key: string;
  serial: number;
}

type Sheet = 'signup' | 'cancel' | null;

export default function EventDetailPage({ id }: { id?: string }): JSX.Element {
  const location = useLocation();
  const routeId = id ?? location.path.split('/')[2] ?? '';
  const viewer = useViewer();

  // UID/活動變更立即隔離 DOM 與所有未完成操作，避免 effect 清理前洩漏舊資料。
  return <EventDetailSession key={`${routeId}:${viewer.uid ?? 'guest'}`}
    publicId={routeId} viewer={viewer} />;
}

function EventDetailSession({
  publicId,
  viewer,
}: {
  publicId: string;
  viewer: ReturnType<typeof useViewer>;
}): JSX.Element {
  const t = useT();
  const location = useLocation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [companions, setCompanions] = useState<SignupCompanion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const sequence = useRef(0);
  const operation = useRef(false);
  const noticeSequence = useRef(0);
  const currentViewer = useRef(viewer);
  currentViewer.current = viewer;

  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      sequence.current += 1;
      window.clearInterval(timer);
    };
  }, []);

  function show(key: string): void {
    if (alive.current) setNotice({ key, serial: ++noticeSequence.current });
  }

  function errorKey(error: unknown, fallback: string): string {
    if (!(error instanceof SignupError)) return fallback;
    // 資料層使用 event.*；功能字典由 i18n loader 加 events.* 前綴。
    return error.messageKey.startsWith('event.')
      ? `events.${error.messageKey.slice('event.'.length)}`
      : error.messageKey;
  }

  useEffect(() => {
    const request = ++sequence.current;
    setPhase('loading');

    (async () => {
      try {
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(publicId)) {
          if (alive.current && request === sequence.current) setPhase('missing');
          return;
        }
        const [detail, history] = await Promise.all([
          loadEventDetail(publicId),
          viewer.uid ? loadViewerRegistrations(viewer.uid) : Promise.resolve([]),
        ]);
        if (!alive.current || request !== sequence.current) return;
        if (!detail || !isEventVisibleToUser(detail.event, currentViewer.current, history)) {
          setSnapshot(null);
          setPhase('missing');
          return;
        }

        // 權限確認前不載入參加名單。
        const registrations = await loadEventRegistrations(detail.eventDocId);
        if (!alive.current || request !== sequence.current) return;
        if (!isEventVisibleToUser(detail.event, currentViewer.current, history)) {
          setSnapshot(null);
          setPhase('missing');
          return;
        }

        setSnapshot({
          event: { ...detail.event, id: detail.event.id ?? publicId },
          eventDocId: detail.eventDocId,
          viewerRegistrations: history,
          registrations,
        });
        setPhase('ready');
      } catch (error) {
        if (!alive.current || request !== sequence.current) return;
        setPhase('error');
        show(errorKey(error, 'events.detailPage.loadError'));
      }
    })().catch(() => {
      if (alive.current && request === sequence.current) setPhase('error');
    });
  }, [publicId, viewer.uid, reload]);

  async function run(work: () => Promise<void>): Promise<void> {
    if (operation.current || !alive.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      show(errorKey(error, 'events.detailPage.actionError'));
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function start(work: () => Promise<void>): void {
    run(work).catch(() => show('events.detailPage.actionError'));
  }

  async function login(): Promise<void> {
    const auth = await import('@/data/auth');
    if (alive.current) await auth.signIn();
  }

  async function refresh(current: Snapshot): Promise<void> {
    try {
      const [registrations, history] = await Promise.all([
        loadEventRegistrations(current.eventDocId),
        viewer.uid ? loadViewerRegistrations(viewer.uid) : Promise.resolve([]),
      ]);
      if (!alive.current) return;
      const active = registrations.filter(isActiveRegistration);
      setSnapshot({
        ...current,
        event: {
          ...current.event,
          current: active.filter((reg) => reg.status === 'confirmed').length,
          waitlist: active.filter((reg) => reg.status === 'waitlisted').length,
        },
        registrations,
        viewerRegistrations: history,
      });
      setRefreshFailed(false);
    } catch (error) {
      if (!alive.current) return;
      // 寫入可能已成功，禁止再次送出；重試只讀名單，不重送 mutation。
      setRefreshFailed(true);
      show(errorKey(error, 'events.detailPage.refreshError'));
    }
  }

  const visible = snapshot !== null &&
    isEventVisibleToUser(snapshot.event, viewer, snapshot.viewerRegistrations);
  const event = snapshot?.event;
  const active = sortRegistrations(snapshot?.registrations ?? []);
  const owned = active.filter((reg) => registrationOwner(reg) === viewer.uid);
  const selfRegistered = owned.some((reg) => !isCompanion(reg));
  const signedCompanions = new Set(owned.map((reg) => reg.companionId).filter(Boolean));

  function check(current: Snapshot, includeSelf: boolean): boolean {
    const eventId = current.event.id ?? publicId;
    // precheckSignup 不自行按 eventId 篩選，禁止將其他活動的紀錄直接傳入。
    const history = current.viewerRegistrations.filter((reg) => reg.eventId === eventId);
    const result = precheckSignup(current.event, currentViewer.current, history, new Date());
    if (result.ok) return true;

    // 只替同行者報名可已有本人報名；其餘前置檢查仍全部執行。
    if (!includeSelf && result.reason === 'already_registered') return true;
    show(result.messageKey.replace(/^event\./, 'events.'));
    return false;
  }

  async function submitSignup(current: Snapshot, keys: readonly string[]): Promise<void> {
    const uid = currentViewer.current.uid;
    if (!uid) {
      await login();
      return;
    }
    const includeSelf = keys.includes('self');
    if (!check(current, includeSelf)) return;
    const chosen = companions.filter((item) => keys.includes(`companion:${item.id}`));
    if (!includeSelf && chosen.length === 0) {
      show('events.detailPage.selectSomeone');
      return;
    }
    await registerSelection({
      eventId: current.event.id ?? publicId,
      user: { uid, displayName: currentViewer.current.displayName },
      companions: chosen.map((item) => ({
        companionId: item.id,
        companionName: item.name,
      })),
    }, includeSelf);
    if (!alive.current) return;
    setSheet(null);
    show('events.detailPage.signupSuccess');
    await refresh(current);
  }

  async function beginSignup(forceSheet: boolean): Promise<void> {
    if (!snapshot || !visible || refreshFailed) return;
    if (!viewer.uid) {
      await login();
      return;
    }
    if (!check(snapshot, !forceSheet)) return;

    const available = await loadSignupCompanions(viewer.uid);
    if (!alive.current) return;
    if (available.length > 0 || forceSheet) {
      setCompanions(available);
      setSelected(forceSheet || selfRegistered ? [] : ['self']);
      setSheet('signup');
    } else {
      await submitSignup(snapshot, ['self']);
    }
  }

  async function submitCancel(): Promise<void> {
    if (!snapshot || !viewer.uid || !visible || selected.length === 0) return;
    const targets = owned.filter((reg) => selected.includes(registrationId(reg)));
    if (targets.length !== selected.length || targets.some((reg) => !registrationId(reg))) {
      show('events.detailPage.refreshError');
      setRefreshFailed(true);
      return;
    }
    await cancelRegistration({
      eventId: snapshot.event.id ?? publicId,
      userId: viewer.uid,
      registrationIds: targets.map(registrationId),
      kind: targets.length === 1 && !isCompanion(targets[0]!)
        ? 'self' : 'companion',
    });
    if (!alive.current) return;
    setSheet(null);
    show('events.detailPage.cancelSuccess');
    await refresh(snapshot);
  }

  function toggle(key: string, checked: boolean): void {
    setSelected((previous) => checked
      ? Array.from(new Set([...previous, key]))
      : previous.filter((value) => value !== key));
  }

  function profile(uid: string): void {
    if (uid) location.route(`/profile/${encodeURIComponent(uid)}`);
  }

  function name(reg: DetailRegistration): string {
    return reg.companionName || reg.userName || t('events.detailPage.unnamed');
  }

  function roster(status: 'confirmed' | 'waitlisted'): JSX.Element {
    const rows = active.filter((reg) => reg.status === status);
    return (
      <section class="event-detail__section">
        <Text as="h2">
          {t(`events.detailPage.${status}`)} {rows.length}
        </Text>
        {rows.length === 0 ? <Text>{t('events.detailPage.emptyRoster')}</Text> : (
          <ul class="event-detail__roster">
            {rows.map((reg, index) => (
              <li key={registrationId(reg) || `${status}:${index}`}>
                {status === 'waitlisted' && <Text>{index + 1}</Text>}
                <UserTag
                  uid={isCompanion(reg) ? '' : registrationOwner(reg)}
                  name={name(reg)}
                  disabled={isCompanion(reg) || !registrationOwner(reg)}
                  onOpenProfile={profile}
                />
                {isCompanion(reg) && <Text>{t('events.detailPage.companion')}</Text>}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const toast = notice && (
    <Toast
      key={notice.serial}
      message={t(notice.key)}
      onClose={() => setNotice(null)}
    />
  );

  if (phase === 'loading') {
    return <section class="event-detail" aria-busy="true">
      <Text>{t('events.detailPage.loading')}</Text>{toast}
    </section>;
  }
  if (phase === 'error') {
    return <section class="event-detail">
      <Text as="h1">{t('events.detailPage.loadError')}</Text>
      <Button onClick={() => setReload((value) => value + 1)}>
        {t('events.retry')}
      </Button>
      {toast}
    </section>;
  }
  if (phase === 'missing' || !snapshot || !event || !visible) {
    return <section class="event-detail">
      <Text as="h1">{t('events.detailPage.notFound')}</Text>
      <a href="/activities"><Text>{t('events.pageTitle')}</Text></a>
    </section>;
  }

  const state = getSignupButtonState({
    event,
    viewer,
    registrations: active,
    now: new Date(now),
  });
  const cover = safeImageUrl(event.imageVariants?.cover || event.image);
  const range = eventDateRange(event.date);
  const maximum = count(event.max);
  const remaining = maximum > 0 ? Math.max(0, maximum - count(event.current)) : null;
  const fee = count(event.fee);
  const selectedCount = selected.length;
  const waitlistedEstimate = remaining === null ? 0 : Math.max(0, selectedCount - remaining);
  const hostUid = event.creatorUid ?? '';
  const canAdd = !['ended', 'upcoming', 'cancelled'].includes(event.status ?? '') &&
    !(range && Date.parse(range.start) <= now);

  return (
    <section class="event-detail">
      <header class="event-detail__header">
        <a href="/activities" aria-label={t('events.pageTitle')}>
          <Text>‹</Text>
        </a>
        <Text as="h1">{event.title || t('events.card.untitled')}</Text>
        {/* 收藏、編輯／管理按鈕延後。 */}
      </header>

      <div class="event-detail__cover">
        {cover ? (
          <img src={cover} alt={event.title ?? ''} width="1200" height="450"
            decoding="async" />
        ) : <Text>{t('events.detailPage.noCover')}</Text>}
      </div>

      <div class="event-detail__body">
        <div class="event-detail__row">
          <Text class="event-detail__label">{t('events.detailPage.location')}</Text>
          <div>
            <Text>{event.location || t('events.card.locationUnknown')}</Text>
            {event.location && (
              <a class="event-detail__map"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                target="_blank" rel="noopener noreferrer">
                <Text>{t('events.detailPage.map')}</Text>
              </a>
            )}
          </div>
        </div>

        <div class="event-detail__row">
          <Text class="event-detail__label">{t('events.detailPage.time')}</Text>
          {range ? <div>
            <DateTime value={range.start} variant="datetime"
              options={{ timeZone: 'Asia/Taipei' }} />
            {range.end && <>
              <Text> – </Text>
              <DateTime value={range.end} variant="time"
                options={{ timeZone: 'Asia/Taipei' }} />
            </>}
          </div> : <Text>{event.date || t('events.card.dateUnknown')}</Text>}
        </div>

        {event.regOpenTime && Number.isFinite(Date.parse(event.regOpenTime)) && (
          <div class="event-detail__row">
            <Text class="event-detail__label">{t('events.detailPage.opens')}</Text>
            <DateTime value={event.regOpenTime} options={{ timeZone: 'Asia/Taipei' }} />
          </div>
        )}

        <div class="event-detail__stats" aria-live="polite">
          <div>
            <Text class="event-detail__label">{t('events.detailPage.fee')}</Text>
            <Text>{fee > 0 ? `NT$${fee}` : t('events.detailPage.free')}</Text>
          </div>
          <div>
            <Text class="event-detail__label">{t('events.detailPage.people')}</Text>
            <Text>{t('events.card.capacity', {
              current: count(event.current),
              max: maximum,
            })}</Text>
          </div>
          <div>
            <Text class="event-detail__label">{t('events.detailPage.waitlisted')}</Text>
            <Text>{count(event.waitlist)}</Text>
          </div>
        </div>

        <div class="event-detail__row event-detail__host">
          <Text class="event-detail__label">{t('events.detailPage.host')}</Text>
          <UserTag uid={hostUid}
            name={event.creator || event.creatorName || t('events.detailPage.unnamed')}
            disabled={!hostUid} onOpenProfile={profile} />
        </div>

        <section class="event-detail__section">
          <Text as="h2">{t('events.detailPage.notes')}</Text>
          <Text as="p" class="event-detail__notes">
            {event.notes || t('events.detailPage.noNotes')}
          </Text>
        </section>

        <div class="event-detail__actions">
          <div class="event-detail__toolbar">
            <Button disabled={busy || refreshFailed || !canAdd}
              onClick={() => start(() => beginSignup(true))}>
              {t('events.detailPage.companionSignup')}
            </Button>
            {/* A 的分享、行事曆位置本批留空，不放不可用按鈕。 */}
          </div>
          <Button
            class={`event-detail__primary event-detail__primary--${state.tone}`}
            loading={busy}
            disabled={state.disabled || busy || refreshFailed}
            onClick={() => {
              if (state.action === 'cancel') {
                setSelected(owned.map(registrationId).filter(Boolean));
                setSheet('cancel');
              } else if (state.action === 'explain') {
                show(state.messageKey ?? 'events.detailPage.actionError');
              } else if (state.action === 'signup') {
                start(() => beginSignup(false));
              }
            }}
          >
            {t(state.labelKey)}
          </Button>
          {refreshFailed && (
            <div role="alert">
              <Text>{t('events.detailPage.refreshError')}</Text>
              <Button loading={busy} disabled={busy}
                onClick={() => start(() => refresh(snapshot))}>
                {t('events.retry')}
              </Button>
            </div>
          )}
        </div>

        {roster('confirmed')}
        {roster('waitlisted')}
        {/* A 名單下方留言區延後。 */}
      </div>

      <BottomSheet
        open={sheet !== null}
        title={t(sheet === 'cancel'
          ? 'events.detailPage.cancelTitle' : 'events.detailPage.chooseParticipants')}
        loading={busy}
        closeOnEsc={!busy}
        closeOnOverlay={!busy}
        onClose={() => { if (!busy) setSheet(null); }}
        footer={<Button
          loading={busy}
          disabled={busy || selected.length === 0}
          onClick={() => start(() => sheet === 'cancel'
            ? submitCancel()
            : submitSignup(snapshot, selected))}
        >
          {t(sheet === 'cancel'
            ? 'events.detailPage.confirmCancel' : 'events.detailPage.confirmSignup')}
        </Button>}
      >
        <div class="event-detail__selection">
          <Text>{event.title || t('events.card.untitled')}</Text>
          {sheet === 'cancel' ? <>
            <Text as="p">{t('events.detailPage.cancelHint')}</Text>
            {owned.map((reg) => {
              const key = registrationId(reg);
              return <Checkbox key={key} label={name(reg)}
                disabled={busy || !key}
                checked={selected.includes(key)}
                onCheckedChange={(checked) => toggle(key, checked)} />;
            })}
          </> : <>
            <Checkbox
              label={`${viewer.displayName || t('events.detailPage.unnamed')} ${t('events.detailPage.self')}`}
              disabled={busy || selfRegistered}
              checked={selfRegistered || selected.includes('self')}
              onCheckedChange={(checked) => toggle('self', checked)}
            />
            {companions.map((item) => {
              const registered = signedCompanions.has(item.id);
              const key = `companion:${item.id}`;
              return <Checkbox key={item.id}
                label={`${item.name}${registered ? ` ${t('events.detailPage.registered')}` : ''}`}
                checked={registered || selected.includes(key)}
                disabled={busy || registered}
                onCheckedChange={(checked) => toggle(key, checked)} />;
            })}
            {companions.length === 0 && <Text>{t('events.detailPage.noCompanions')}</Text>}
            <div aria-live="polite">
              <Text as="p">{t('events.detailPage.selected', { count: selectedCount })}</Text>
              <Text as="p">{t('events.detailPage.totalFee', { fee: fee * selectedCount })}</Text>
              {remaining !== null && <Text as="p">
                {t('events.detailPage.remaining', { count: remaining })}
              </Text>}
              {waitlistedEstimate > 0 && <Text as="p">
                {t('events.detailPage.waitlistEstimate', { count: waitlistedEstimate })}
              </Text>}
            </div>
          </>}
        </div>
      </BottomSheet>
      {toast}
    </section>
  );
}
