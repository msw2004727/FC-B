// 建賽精靈：基本資料、組別（全部展開）、確認後建立草稿，再發布。
// 場地選點沿用活動的 EventLocationPicker，只在點開時才載入。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import { Textarea } from '@/ui/Textarea';
import type { EventLocationSelection } from '@/features/events/components/event-form/EventLocationPicker';
import { liveCpActions } from '../actions';
import { useInjectedEnv, type CpInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { clipCodePoints, fromDatetimeLocalValue, formatTaipeiDateTime } from '../format';
import { buildCreateInput, type DivisionDraft, type VenueDraft, type WizardDraft } from '../payload';
import { representativeClubs } from '../rep-clubs';
import { CpError, errorOf, reasonText } from '../ui/feedback';
import { DateTimeField, FeeLine } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending, CpRow, TrashIcon } from '../ui/shell';

const FORMATS = [5, 7, 8, 9, 11] as const;

function emptyDivision(): DivisionDraft {
  return {
    name: '',
    playersOnField: 5,
    maxTeams: 8,
    rosterMin: 7,
    rosterMax: 12,
    limitAge: false,
    minAge: 8,
    maxAge: 12,
    requireRealName: false,
    feePerTeam: 0,
  };
}

function emptyVenue(): VenueDraft {
  return { name: '', address: '' };
}

interface FormState {
  name: string;
  hostType: 'personal' | 'club';
  hostTeamId: string;
  feeNote: string;
  regOpen: string;
  regClose: string;
  firstMatch: string;
  lastMatch: string;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
}

function blankForm(): FormState {
  return {
    name: '',
    hostType: 'personal',
    hostTeamId: '',
    feeNote: '',
    regOpen: '',
    regClose: '',
    firstMatch: '',
    lastMatch: '',
    venues: [emptyVenue()],
    divisions: [{ ...emptyDivision(), name: '' }],
  };
}

function formFromEnv(env: CpInjectedEnv): FormState {
  const seed = env.wizardSeed;
  if (!seed) return blankForm();
  return {
    name: seed.name,
    hostType: env.preview?.wizardClub ? 'club' : seed.hostType,
    hostTeamId: seed.hostTeamId,
    feeNote: seed.feeNote,
    regOpen: seed.regOpen,
    regClose: seed.regClose,
    firstMatch: seed.firstMatch,
    lastMatch: seed.lastMatch,
    venues: seed.venues.map((venue) => ({ ...venue })),
    divisions: seed.divisions.map((division) => ({ ...division })),
  };
}

function toDraft(form: FormState, hostDisplay: string): WizardDraft | null {
  const regOpenAt = fromDatetimeLocalValue(form.regOpen);
  const regCloseAt = fromDatetimeLocalValue(form.regClose);
  const firstMatchAt = fromDatetimeLocalValue(form.firstMatch);
  const lastMatchAt = fromDatetimeLocalValue(form.lastMatch);
  if (regOpenAt == null || regCloseAt == null || firstMatchAt == null || lastMatchAt == null) return null;
  return {
    name: form.name,
    hostType: form.hostType,
    hostTeamId: form.hostTeamId,
    hostDisplay,
    feeNote: form.feeNote,
    regOpenAt,
    regCloseAt,
    firstMatchAt,
    lastMatchAt,
    venues: form.venues,
    divisions: form.divisions,
  };
}

function MapPicker({
  venue,
  onClose,
  onConfirm,
}: {
  venue: VenueDraft;
  onClose: () => void;
  onConfirm: (selection: EventLocationSelection) => void;
}): JSX.Element | null {
  const [Comp, setComp] = useState<((props: {
    locationText: string;
    initial: { lat: number | null; lng: number | null; mapAddress: string; mapPlaceId: string };
    onClose: () => void;
    onConfirm: (selection: EventLocationSelection) => void;
  }) => JSX.Element) | null>(null);
  useEffect(() => {
    let alive = true;
    void import('@/features/events/components/event-form/EventLocationPicker').then((mod) => {
      if (alive) setComp(() => mod.EventLocationPicker);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!Comp) return null;
  return (
    <Comp
      locationText={venue.address || venue.name}
      initial={{
        lat: venue.lat ?? null,
        lng: venue.lng ?? null,
        mapAddress: venue.address,
        mapPlaceId: venue.mapPlaceId ?? '',
      }}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function WizardView({ env }: { env: CpInjectedEnv }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const preview = env.preview;
  const [step, setStep] = useState<1 | 2 | 3>(preview?.wizardStep === 2 || preview?.wizardStep === 3 ? preview.wizardStep : 1);
  const [done, setDone] = useState(preview?.wizardStep === 'done');
  const [cid, setCid] = useState('');
  const [form, setForm] = useState<FormState>(() => formFromEnv(env));
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(
    preview?.wizardError ? { reason: 'BANNED_WORD' } : null,
  );
  const [busy, setBusy] = useState(false);
  const [mapIndex, setMapIndex] = useState<number | null>(null);
  const clubs = representativeClubs(env.actor);
  // ASSUMPTION: repClubsPending 省略＝清單已定案。還在讀時空陣列不改回個人，晚到的俱樂部仍要補上。
  const clubsPending = env.actor.repClubsPending === true;

  useEffect(() => {
    if (form.hostType !== 'club') return;
    if (clubsPending) return;
    if (clubs.length === 0) {
      // 沒有可用俱樂部不能維持 club：後端 club 必填 hostTeamId。
      setForm((prev) => (
        prev.hostType === 'personal' && prev.hostTeamId === ''
          ? prev
          : { ...prev, hostType: 'personal', hostTeamId: '' }
      ));
      return;
    }
    if (form.hostTeamId && clubs.some((club) => club.id === form.hostTeamId)) return;
    const first = clubs[0]?.id ?? '';
    if (!first) return;
    setForm((prev) => (prev.hostTeamId === first ? prev : { ...prev, hostTeamId: first }));
  }, [clubs, clubsPending, form.hostType, form.hostTeamId]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;

  function patch(partial: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function patchDivision(index: number, partial: Partial<DivisionDraft>): void {
    setForm((prev) => ({
      ...prev,
      divisions: prev.divisions.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    }));
  }

  function patchVenue(index: number, partial: Partial<VenueDraft>): void {
    setForm((prev) => ({
      ...prev,
      venues: prev.venues.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    }));
  }

  function step1Reason(): { reason: string; params?: Record<string, unknown> } | null {
    const name = form.name.trim();
    if (name.length < 2 || name.length > 60) return { reason: 'FIELD_LENGTH', params: { min: 2, max: 60 } };
    if (form.hostType === 'club' && !form.hostTeamId) return { reason: 'FIELD_REQUIRED' };
    const draft = toDraft(form, env.actor.displayName ?? '');
    if (!draft) return { reason: 'FIELD_REQUIRED' };
    if (!(draft.regOpenAt < draft.regCloseAt && draft.regCloseAt <= draft.firstMatchAt && draft.firstMatchAt <= draft.lastMatchAt)) {
      return { reason: 'SCHEDULE_ORDER' };
    }
    if (draft.firstMatchAt <= (env.now ?? Date.now())) return { reason: 'SCHEDULE_PAST' };
    if (form.venues.length < 1 || form.venues.some((venue) => {
      const nameLen = venue.name.trim().length;
      return nameLen < 1 || nameLen > 40;
    })) return { reason: 'FIELD_REQUIRED' };
    if (form.hostType === 'club' && form.feeNote.trim().length > 500) {
      return { reason: 'FIELD_LENGTH', params: { min: 0, max: 500 } };
    }
    return null;
  }

  function step2Reason(): { reason: string; params?: Record<string, unknown> } | null {
    if (form.divisions.length < 1 || form.divisions.length > 8) return { reason: 'FIELD_REQUIRED' };
    for (const division of form.divisions) {
      const nameLen = division.name.trim().length;
      if (nameLen < 1 || nameLen > 30) return { reason: 'FIELD_LENGTH', params: { min: 1, max: 30 } };
      if (division.maxTeams < 2 || division.maxTeams > 64) return { reason: 'FIELD_RANGE' };
      if (division.rosterMax < division.playersOnField || division.rosterMax > 40) return { reason: 'FIELD_RANGE' };
      if (division.rosterMin < 1 || division.rosterMin > division.rosterMax) return { reason: 'FIELD_RANGE' };
      if (division.feePerTeam < 0 || division.feePerTeam > 1_000_000) return { reason: 'FIELD_RANGE' };
      if (division.limitAge && division.minAge > division.maxAge) return { reason: 'FIELD_RANGE' };
    }
    return null;
  }

  function goNext(): void {
    const problem = step === 1 ? step1Reason() : step2Reason();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep(step === 1 ? 2 : 3);
  }

  async function create(): Promise<void> {
    const problem = step1Reason() ?? step2Reason();
    const draft = toDraft(form, env.actor.displayName ?? '');
    if (problem || !draft || busy) {
      if (problem) setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await env.actions.create(buildCreateInput(draft));
      setCid(result.cid);
      setDone(true);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    if (!cid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.publish({ cid });
      route(`/competitions/${cid}`);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const stepName = step === 1 ? ct('stepBasic') : step === 2 ? ct('stepDivisions') : ct('stepConfirm');
  const hostName = form.hostType === 'club'
    ? (clubs.find((club) => club.id === form.hostTeamId)?.name ?? '')
    : (env.actor.displayName ?? '');

  if (done) {
    return (
      <CpFrame title={ct('createTitle')}>
        <CpCard class="cps-success">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
          <h2 class="cps-title" style="margin:12px 0 4px">{ct('createdDraft')}</h2>
          <p class="cps-sub">{form.name.trim()}</p>
          {error ? <CpError reason={error.reason} params={error.params} /> : null}
          <div class="cps-actions cps-actions--col">
            <Button variant="primary" loading={busy} onClick={() => { void publish(); }}>{ct('publish')}</Button>
            <Button variant="secondary" onClick={() => route(cid ? `/competitions/${cid}` : '/tournaments')}>{ct('publishLater')}</Button>
          </div>
        </CpCard>
      </CpFrame>
    );
  }

  const draftTimes = toDraft(form, '');

  return (
    <CpFrame
      title={ct('createTitle')}
      onBack={step === 1 ? undefined : () => { setError(null); setStep(step === 3 ? 2 : 1); }}
    >
      <div>
        <div class="cps-steps" aria-hidden="true">
          {[1, 2, 3].map((n) => <i key={n} class={n <= step ? 'on' : ''} />)}
        </div>
        <div class="cps-stepname"><span>{ct('stepOf', { step })}</span><b>{stepName}</b></div>
      </div>

      {step === 1 ? (
        <>
          <CpCard>
            <div class="cps-fields">
              <Input
                label={ct('name')}
                required
                value={form.name}
                maxLength={60}
                error={error?.reason === 'BANNED_WORD' || (error?.reason === 'FIELD_LENGTH' && step === 1)
                  ? reasonText(ct, error.reason, error.params)
                  : undefined}
                onValueChange={(name) => { patch({ name }); setError(null); }}
              />
              <RadioGroup
                label={ct('hostKind')}
                orientation="horizontal"
                value={form.hostType}
                onValueChange={(value) => {
                  const hostType = value === 'club' ? 'club' : 'personal';
                  patch({
                    hostType,
                    hostTeamId: hostType === 'club' ? (form.hostTeamId || clubs[0]?.id || '') : form.hostTeamId,
                  });
                }}
                options={[
                  { value: 'personal', label: ct('hostPersonalShort') },
                  ...(clubs.length > 0 ? [{ value: 'club', label: ct('hostClubOption') }] : []),
                ]}
              />
              {form.hostType === 'club' && clubs.length > 0 ? (
                <Select
                  label={ct('club')}
                  value={form.hostTeamId}
                  onValueChange={(hostTeamId) => patch({ hostTeamId })}
                  options={clubs.map((club) => ({ value: club.id, label: club.name }))}
                />
              ) : null}
              {form.hostType === 'club' ? (
                <div>
                  <Textarea
                    label={ct('feeNote')}
                    value={form.feeNote}
                    maxLength={500}
                    onValueChange={(feeNote) => patch({ feeNote })}
                  />
                  <p class="cps-cap" style="margin-top:6px">
                    <span class="cps-line">{ct('feeHandledByHost')}</span>
                    <span class="cps-line">{ct('feeSiteDoesNotHandle')}</span>
                  </p>
                </div>
              ) : null}
            </div>
          </CpCard>
          <CpCard>
            <h2 class="cps-h">{ct('regPeriod')}</h2>
            <div class="cps-fields">
              <DateTimeField id="cp-reg-open" label={ct('regStart')} value={form.regOpen} onValueChange={(regOpen) => patch({ regOpen })} />
              <DateTimeField id="cp-reg-close" label={ct('regEnd')} value={form.regClose} onValueChange={(regClose) => patch({ regClose })} />
            </div>
          </CpCard>
          <CpCard>
            <h2 class="cps-h">{ct('matchPeriod')}</h2>
            <div class="cps-fields">
              <DateTimeField id="cp-first" label={ct('firstMatch')} value={form.firstMatch} onValueChange={(firstMatch) => patch({ firstMatch })} />
              <DateTimeField id="cp-last" label={ct('lastMatch')} value={form.lastMatch} onValueChange={(lastMatch) => patch({ lastMatch })} />
            </div>
          </CpCard>
          <CpCard>
            <h2 class="cps-h">{ct('venue')}</h2>
            <div class="cps-fields">
              {form.venues.map((venue, index) => (
                <div class="cps-fields" key={index}>
                  <div class="cps-head-row">
                    <Input
                      label={ct('venueName')}
                      value={venue.name}
                      maxLength={40}
                      onValueChange={(name) => patchVenue(index, { name })}
                    />
                    {form.venues.length > 1 ? (
                      <button type="button" class="cps-iconbtn cps-iconbtn--flat" aria-label={ct('removeVenue')} onClick={() => patch({ venues: form.venues.filter((_, i) => i !== index) })}>
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                  <Input
                    label={ct('venueAddress')}
                    value={venue.address}
                    maxLength={100}
                    onValueChange={(address) => patchVenue(index, { address, mapPlaceId: '', mapProvider: address === venue.address ? venue.mapProvider : 'manual' })}
                  />
                  <Button variant="secondary" onClick={() => setMapIndex(index)}>{ct('pickOnMap')}</Button>
                </div>
              ))}
              {form.venues.length < 10 ? (
                <Button variant="secondary" onClick={() => patch({ venues: [...form.venues, emptyVenue()] })}>{ct('addVenue')}</Button>
              ) : null}
            </div>
          </CpCard>
        </>
      ) : null}

      {step === 2 ? (
        <>
          {form.divisions.map((division, index) => (
            <CpCard key={index}>
              <div class="cps-head-row" style="margin-bottom:12px">
                <h2 class="cps-h">{ct('divisionN', { n: index + 1 })}</h2>
                {form.divisions.length > 1 ? (
                  <button
                    type="button"
                    class="cps-iconbtn cps-iconbtn--flat"
                    aria-label={ct('removeDivision')}
                    onClick={() => patch({ divisions: form.divisions.filter((_, i) => i !== index) })}
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
              <div class="cps-fields">
                <Input label={ct('divisionName')} value={division.name} maxLength={30} onValueChange={(name) => patchDivision(index, { name })} />
                <div>
                  <span class="cps-label">{ct('playersOnField')}</span>
                  <div class="cps-chips">
                    {FORMATS.map((count) => (
                      <Chip
                        key={count}
                        label={ct('formatN', { n: count })}
                        size="sm"
                        selected={division.playersOnField === count}
                        onSelect={() => {
                          const playersOnField = count;
                          const rosterMax = Math.max(division.rosterMax, playersOnField);
                          const rosterMin = Math.min(division.rosterMin, rosterMax);
                          patchDivision(index, { playersOnField, rosterMax, rosterMin });
                        }}
                      />
                    ))}
                  </div>
                </div>
                <Stepper label={ct('maxTeams')} value={division.maxTeams} min={2} max={64} onValueChange={(maxTeams) => patchDivision(index, { maxTeams })} />
                <Stepper label={ct('rosterMin')} value={division.rosterMin} min={1} max={division.rosterMax} onValueChange={(rosterMin) => patchDivision(index, { rosterMin })} />
                <Stepper
                  label={ct('rosterMax')}
                  value={division.rosterMax}
                  min={division.playersOnField}
                  max={40}
                  onValueChange={(rosterMax) => patchDivision(index, {
                    rosterMax,
                    rosterMin: Math.min(division.rosterMin, rosterMax),
                  })}
                />
                <Switch
                  label={ct('limitAge')}
                  checked={division.limitAge}
                  onCheckedChange={(limitAge) => patchDivision(index, {
                    limitAge,
                    requireRealName: limitAge ? true : division.requireRealName,
                  })}
                />
                {division.limitAge ? (
                  <>
                    <Stepper label={ct('minAge')} value={division.minAge} min={3} max={99} onValueChange={(minAge) => patchDivision(index, { minAge })} />
                    <Stepper label={ct('maxAge')} value={division.maxAge} min={3} max={99} onValueChange={(maxAge) => patchDivision(index, { maxAge })} />
                  </>
                ) : null}
                <Switch
                  label={ct('requireRealName')}
                  checked={division.requireRealName}
                  onCheckedChange={(requireRealName) => patchDivision(index, { requireRealName })}
                />
                <Input
                  label={ct('feePerTeam')}
                  type="number"
                  value={String(division.feePerTeam)}
                  min={0}
                  max={1000000}
                  onValueChange={(raw) => {
                    const parsed = Number(raw);
                    const feePerTeam = Number.isFinite(parsed) ? Math.max(0, Math.min(1_000_000, Math.trunc(parsed))) : 0;
                    patchDivision(index, { feePerTeam });
                  }}
                />
              </div>
            </CpCard>
          ))}
          {form.divisions.length < 8 ? (
            <Button variant="secondary" onClick={() => patch({ divisions: [...form.divisions, emptyDivision()] })}>{ct('addDivision')}</Button>
          ) : null}
        </>
      ) : null}

      {step === 3 && draftTimes ? (
        <>
          <CpCard>
            <div class="cps-badges" style="margin-bottom:8px">
              <Badge tone={form.hostType === 'club' ? 'info' : 'neutral'} label={form.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')} size="sm" />
              <Badge tone="warning" label={ct('draft')} size="sm" />
            </div>
            <h2 class="cps-title" style="margin-bottom:12px">{form.name.trim()}</h2>
            <dl class="cps-rows">
              <CpRow k={ct('host')}>{hostName}</CpRow>
              <CpRow k={ct('regPeriod')}>
                <span class="cps-line">{formatTaipeiDateTime(draftTimes.regOpenAt)}</span>
                <span class="cps-line">{ct('until')} {formatTaipeiDateTime(draftTimes.regCloseAt)}</span>
              </CpRow>
              <CpRow k={ct('matchPeriod')}>
                <span class="cps-line">{formatTaipeiDateTime(draftTimes.firstMatchAt)}</span>
                <span class="cps-line">{ct('until')} {formatTaipeiDateTime(draftTimes.lastMatchAt)}</span>
              </CpRow>
              <CpRow k={ct('venue')}>
                {form.venues.map((venue) => <span class="cps-line" key={venue.name}>{venue.name}</span>)}
              </CpRow>
            </dl>
          </CpCard>
          <CpCard>
            <h2 class="cps-h">{ct('stepDivisions')}</h2>
            <ul class="cps-list">
              {form.divisions.map((division) => (
                <li class="cps-li" key={division.name}>
                  <div class="cps-li__main">
                    <span class="cps-li__name">{division.name}</span>
                    <div class="cps-li__meta">
                      <span class="cps-cap cps-nowrap">
                        {ct('divisionLine', {
                          format: ct('formatN', { n: division.playersOnField }),
                          teams: division.maxTeams,
                          min: division.rosterMin,
                          max: division.rosterMax,
                        })}
                        {division.limitAge ? `　${ct('ageLimit', { min: division.minAge, max: division.maxAge })}` : ''}
                      </span>
                    </div>
                    <FeeLine amount={division.feePerTeam} />
                  </div>
                </li>
              ))}
            </ul>
          </CpCard>
          <p class="cps-note">{ct('draftNote')}</p>
        </>
      ) : null}

      {error && !(step === 1 && (error.reason === 'BANNED_WORD' || error.reason === 'FIELD_LENGTH'))
        ? <CpError reason={error.reason} params={error.params} />
        : null}

      <div class="cps-actions">
        {step > 1 ? <Button variant="secondary" onClick={() => { setError(null); setStep(step === 3 ? 2 : 1); }}>{ct('prev')}</Button> : null}
        {step < 3 ? <Button variant="primary" onClick={goNext}>{ct('next')}</Button> : (
          <Button variant="primary" loading={busy} onClick={() => { void create(); }}>{ct('createAction')}</Button>
        )}
      </div>

      {mapIndex != null ? (
        <MapPicker
          venue={form.venues[mapIndex] ?? emptyVenue()}
          onClose={() => setMapIndex(null)}
          onConfirm={(selection) => {
            const picked = form.venues[mapIndex]?.address || selection.mapAddress;
            patchVenue(mapIndex, {
              lat: selection.lat,
              lng: selection.lng,
              mapPlaceId: selection.mapPlaceId,
              mapProvider: selection.mapProvider,
              address: clipCodePoints(picked, 100),
            });
            setMapIndex(null);
          }}
        />
      ) : null}
    </CpFrame>
  );
}

export default function NewCompetitionPage(): JSX.Element {
  const injected = useInjectedEnv();
  if (injected) return <WizardView env={injected} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <WizardView env={{ actor, repo, actions: liveCpActions }} />}
    </LiveBoundary>
  );
}
