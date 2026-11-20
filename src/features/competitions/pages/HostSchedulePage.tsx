// 主辦排賽程。預覽帶 dryRun，產生賽程帶回預覽的 seed，結果與預覽相同。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { canHostOrCo, isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import type { CpGenerateScheduleInput } from '../data/cp-callables';
import {
  allVenueIdx,
  initialDays,
  parseScheduleForm,
  previewFromResult,
  type DayDraft,
  type ParsedSchedule,
} from '../data/host-write';
import type { StaffDoc } from '../data/types';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { CpError, CpLoadFailed, errorOf, loadFailOf, reasonText } from '../ui/feedback';
import { DateField } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending } from '../ui/shell';

interface HeldPreview {
  value: ParsedSchedule;
  seed: number;
}

type PreviewCard = { kind: 'ok'; m: number; d: number; p: number } | { kind: 'bad'; n: number };

function allowedOf(env: CpInjectedEnv, staff: StaffDoc | null): boolean {
  return canHostOrCo({
    staffRoles: staff?.roles ?? [],
    isAdmin: isCpAdmin(env.actor.role),
  });
}

async function loadBundle(env: CpInjectedEnv, cid: string): Promise<CpBundle | null> {
  const uid = env.actor.uid;
  const [competition, divisions, staff] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
  ]);
  if (!competition) return null;
  return { competition, divisions, entries: [], roster: [], privates: [], staff };
}

function HostScheduleView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const competition = bundle?.competition ?? null;
  const divisions = bundle?.divisions ?? [];
  const [legs, setLegs] = useState<1 | 2>(1);
  const [minutes, setMinutes] = useState('40');
  const [buffer, setBuffer] = useState('10');
  const daySerial = useRef(0);
  const [days, setDays] = useState<DayDraft[]>(() => {
    if (!competition) return [];
    const rows = initialDays(competition.firstMatchAt, competition.lastMatchAt);
    daySerial.current = rows.length;
    return rows;
  });
  const [venueOn, setVenueOn] = useState<number[]>(() => allVenueIdx(competition?.venues.length ?? 0));
  const [dvId, setDvId] = useState(divisions[0]?.dvId ?? '');
  const [held, setHeld] = useState<HeldPreview | null>(null);
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  const [formError, setFormError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const lock = useRef(false);
  const previewSeq = useRef(0);
  const seeded = useRef(Boolean(competition));

  useEffect(() => {
    if (env.bundle) return undefined;
    let alive = true;
    void loadBundle(env, cid).then((next) => {
      if (!alive) return;
      setBundle(next);
      setPhase(next ? 'ready' : 'missing');
    }).catch((err: unknown) => {
      if (alive) setPhase(loadFailOf(err));
    });
    return () => {
      alive = false;
    };
    // 正式頁只在 cid 或身分變時重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.actor.role, env.bundle]);

  useEffect(() => {
    if (!competition || seeded.current) return;
    seeded.current = true;
    const rows = initialDays(competition.firstMatchAt, competition.lastMatchAt);
    daySerial.current = Math.max(daySerial.current, rows.length);
    setDays(rows);
    setVenueOn(allVenueIdx(competition.venues.length));
    setDvId(divisions[0]?.dvId ?? '');
  }, [competition, divisions]);

  function clearHeld(): void {
    previewSeq.current += 1;
    setHeld(null);
    setPreview(null);
  }

  function showReason(reason: string, params?: Record<string, unknown>): void {
    toast.show({ message: reasonText(ct, reason, params), tone: 'error' });
    setFormError({ reason, params });
  }

  async function previewSchedule(): Promise<void> {
    if (lock.current || !competition) return;
    const parsed = parseScheduleForm({
      dvId, legs, matchMinutes: minutes, bufferMinutes: buffer, days, venueIdx: venueOn,
    });
    if (!parsed.ok) {
      showReason(parsed.reason);
      setHeld(null);
      setPreview(null);
      return;
    }
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    lock.current = true;
    setBusy(true);
    setFormError(null);
    const input: CpGenerateScheduleInput = {
      cid,
      dvId: parsed.value.dvId,
      legs: parsed.value.legs,
      matchMinutes: parsed.value.matchMinutes,
      bufferMinutes: parsed.value.bufferMinutes,
      days: parsed.value.days,
      venueIdx: parsed.value.venueIdx,
      dryRun: true,
    };
    try {
      const result = await env.actions.generateSchedule(input);
      if (previewSeq.current !== seq) return;
      const view = previewFromResult(result);
      if (view.kind === 'bad') {
        setPreview(view);
        setHeld(null);
        return;
      }
      setPreview({ kind: 'ok', m: view.m, d: view.d, p: view.p });
      setHeld({ value: parsed.value, seed: view.seed });
    } catch (err) {
      if (previewSeq.current !== seq) return;
      const info = errorOf(err);
      const count = info.params.unplacedCount;
      if (info.reason === 'SCHEDULE_UNPLACED' && typeof count === 'number') {
        setPreview({ kind: 'bad', n: count });
        setHeld(null);
        toast.show({ message: ct('schedPreviewBad', { n: count }), tone: 'error' });
        setFormError(null);
        return;
      }
      setHeld(null);
      setPreview(null);
      showReason(info.reason, info.params);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    if (lock.current || !held) return;
    lock.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const result = await env.actions.generateSchedule({
        cid,
        dvId: held.value.dvId,
        legs: held.value.legs,
        matchMinutes: held.value.matchMinutes,
        bufferMinutes: held.value.bufferMinutes,
        days: held.value.days,
        venueIdx: held.value.venueIdx,
        seed: held.seed,
        dryRun: false,
      });
      const view = previewFromResult(result);
      if (view.kind === 'bad') {
        setPreview(view);
        setHeld(null);
        toast.show({ message: ct('schedPreviewBad', { n: view.n }), tone: 'error' });
        return;
      }
      toast.show({
        message: ct('schedPreviewOk', { m: view.m, d: view.d, p: view.p }),
        tone: 'success',
      });
      route(`/competitions/${cid}/matches`);
    } catch (err) {
      const info = errorOf(err);
      showReason(info.reason, info.params);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function clearSchedule(): Promise<void> {
    if (lock.current || !dvId) return;
    lock.current = true;
    setBusy(true);
    try {
      await env.actions.clearSchedule({ cid, dvId });
      setFormError(null);
      setClearOpen(false);
      clearHeld();
    } catch (err) {
      const info = errorOf(err);
      showReason(info.reason, info.params);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (env.actor.authPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'error' || phase === 'hidden' || !competition) {
    return <CpLoadFailed title={ct('hostSchedTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }
  // ASSUMPTION: 「無權限」沿用 reason.NOT_HOST，不另造句子。俱樂部代表不是 staff 時擋下。
  if (!allowedOf(env, bundle?.staff ?? null)) {
    return (
      <CpFrame title={ct('hostSchedTitle')}>
        <p class="cps-note" role="alert">{ct('reason.NOT_HOST')}</p>
      </CpFrame>
    );
  }

  function patchDay(index: number, patch: Partial<DayDraft>): void {
    setDays((prev) => prev.map((day, i) => (i === index ? { ...day, ...patch } : day)));
    clearHeld();
  }

  return (
    <CpFrame title={ct('hostSchedTitle')}>
      <p class="cps-sub" style="margin:0">{competition.name}</p>
      <CpCard>
        <div class="cps-fields">
          {divisions.length > 1 ? (
            <Select
              label={ct('divisionPick')}
              value={dvId}
              disabled={busy}
              onValueChange={(value) => { setDvId(value); clearHeld(); }}
              options={divisions.map((division) => ({ value: division.dvId, label: division.name }))}
            />
          ) : null}
          <RadioGroup
            label={ct('schedFormat')}
            value={legs === 2 ? '2' : '1'}
            disabled={busy}
            onValueChange={(value) => { setLegs(value === '2' ? 2 : 1); clearHeld(); }}
            orientation="horizontal"
            options={[{ value: '1', label: ct('schedSingle') }, { value: '2', label: ct('schedDouble') }]}
          />
          <div class="cps-grid2">
            <Input label={ct('schedMinutes')} type="number" value={minutes} disabled={busy} onValueChange={(value) => { setMinutes(value); clearHeld(); }} />
            <Input label={ct('schedBuffer')} type="number" value={buffer} disabled={busy} onValueChange={(value) => { setBuffer(value); clearHeld(); }} />
          </div>
        </div>
      </CpCard>
      <CpCard>
        <h3 class="cp3-sec-h">{ct('schedMatchDay')}</h3>
        {days.map((day, index) => (
          <div class="cp3-dayform" key={day.id ?? `idx-${index}`}>
            <div class="cp3-dayform__h">
              <span>{ct('schedDayN', { n: index + 1 })}</span>
              {index > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setDays((prev) => prev.filter((_, i) => i !== index));
                    clearHeld();
                  }}
                >
                  {ct('remove')}
                </Button>
              ) : null}
            </div>
            <div class="cps-fields">
              <DateField id={`cp-day-${day.id ?? index}`} label={ct('schedDate')} value={day.date} disabled={busy} onValueChange={(value) => patchDay(index, { date: value })} />
              <div class="cps-grid2">
                <Input label={ct('schedStart')} value={day.start} disabled={busy} onValueChange={(value) => patchDay(index, { start: value })} />
                <Input label={ct('schedEnd')} value={day.end} disabled={busy} onValueChange={(value) => patchDay(index, { end: value })} />
              </div>
            </div>
          </div>
        ))}
        <div class="cps-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              daySerial.current += 1;
              const id = `day-${daySerial.current}`;
              setDays((prev) => [...prev, { id, date: '', start: '09:00', end: '18:00' }]);
              clearHeld();
            }}
          >
            {ct('schedAddDay')}
          </Button>
        </div>
      </CpCard>
      <CpCard>
        <h3 class="cp3-sec-h">{ct('schedVenues')}</h3>
        <div class="cp3-checks">
          {competition.venues.map((venue, index) => (
            <Checkbox
              key={`${venue.name}-${index}`}
              label={venue.name || ct('venue')}
              checked={venueOn.includes(index)}
              disabled={busy}
              onCheckedChange={(checked) => {
                setVenueOn((prev) => {
                  const next = prev.filter((item) => item !== index);
                  if (checked) next.push(index);
                  next.sort((a, b) => a - b);
                  return next;
                });
                clearHeld();
              }}
            />
          ))}
        </div>
      </CpCard>
      <div class="cps-actions" style="margin-top:0">
        <Button variant="secondary" disabled={busy} onClick={() => { void previewSchedule(); }}>{ct('schedPreview')}</Button>
      </div>
      {preview?.kind === 'ok' ? (
        <CpCard class="cps-card--ok"><p class="cp3-result">{ct('schedPreviewOk', { m: preview.m, d: preview.d, p: preview.p })}</p></CpCard>
      ) : null}
      {preview?.kind === 'bad' ? (
        <CpCard class="cps-card--warn"><p class="cp3-result--bad">{ct('schedPreviewBad', { n: preview.n })}</p></CpCard>
      ) : null}
      {formError ? <CpError reason={formError.reason} params={formError.params} /> : null}
      {formError?.reason === 'SCHEDULE_REPLACE_TOO_LARGE' ? (
        <div class="cps-actions" style="margin-top:0">
          <Button variant="danger" disabled={busy} onClick={() => setClearOpen(true)}>{ct('schedClear')}</Button>
        </div>
      ) : null}
      {clearOpen ? (
        <Modal
          open
          title={ct('schedClear')}
          onClose={() => { if (!lock.current) setClearOpen(false); }}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={() => setClearOpen(false)}>{ct('cancel')}</Button>
              <Button variant="danger" disabled={busy} onClick={() => { void clearSchedule(); }}>{ct('schedClear')}</Button>
            </div>
          )}
        >
          <p class="cp3-modal-p">{ct('schedClearConfirm')}</p>
        </Modal>
      ) : null}
      <div class="cps-actions" style="margin-top:0">
        <Button variant="primary" disabled={busy || held == null} onClick={() => { void generate(); }}>{ct('schedGenerate')}</Button>
      </div>
    </CpFrame>
  );
}

export default function HostSchedulePage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <HostScheduleView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <HostScheduleView env={{ actor, repo, actions: liveCpActions }} cid={cid} />}
    </LiveBoundary>
  );
}
