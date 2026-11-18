// 賽程管理上的整天順延與兩場對調。改期仍留在場次列的底頁。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { toast } from '@/ui/Toast';
import { boundedReason } from '../data/host-write';
import {
  clashSentence,
  matchPickLabel,
  movableOnDay,
  nextCalendarDay,
  shiftDayChoices,
  shiftDayLabel,
  shiftMovesLater,
  swappableMatches,
  swapPreview,
  type ScheduleClash,
} from '../data/flex-schedule';
import type { MatchDoc } from '../data/types';
import type { CompetitionsT } from '../i18n';
import { reasonText } from '../ui/feedback';
import { DateField } from '../ui/fields';
import { CpCard } from '../ui/shell';

export interface ShiftRequest {
  fromDate: string;
  toDate: string;
  reason: string;
  force: boolean;
}

export interface SwapRequest {
  mtIdA: string;
  mtIdB: string;
  expectedRevA: number;
  expectedRevB: number;
  reason: string;
  force: boolean;
}

function reject(ct: CompetitionsT, reason: string, params?: Record<string, number>): void {
  toast.show({ message: reasonText(ct, reason, params), tone: 'error' });
}

export function HostFlexCards({
  ct,
  matches,
  weekdays,
  busy,
  onShift,
  onSwap,
}: {
  ct: CompetitionsT;
  matches: readonly MatchDoc[];
  weekdays: readonly string[];
  busy: boolean;
  onShift: (input: ShiftRequest) => Promise<ScheduleClash | null>;
  onSwap: (input: SwapRequest) => Promise<ScheduleClash | null>;
}): JSX.Element {
  const choices = shiftDayChoices(matches);
  const rows = swappableMatches(matches);
  const [fromPick, setFromPick] = useState('');
  const [toDate, setToDate] = useState('');
  const [shiftReason, setShiftReason] = useState('');
  const [shiftClash, setShiftClash] = useState<ScheduleClash | null>(null);
  const [pickA, setPickA] = useState('');
  const [pickB, setPickB] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [swapClash, setSwapClash] = useState<ScheduleClash | null>(null);

  const fromDate = choices.some((choice) => choice.date === fromPick) ? fromPick : (choices[0]?.date ?? '');
  const idA = rows.some((match) => match.id === pickA) ? pickA : (rows[0]?.id ?? '');
  const idB = rows.some((match) => match.id === pickB) ? pickB : (rows.find((match) => match.id !== idA)?.id ?? '');
  const affected = fromDate ? movableOnDay(matches, fromDate).length : 0;
  const matchA = rows.find((match) => match.id === idA) ?? null;
  const matchB = rows.find((match) => match.id === idB) ?? null;
  const shiftHit = shiftClash ? matches.find((match) => match.id === shiftClash.mtId) : undefined;
  const swapHit = swapClash ? matches.find((match) => match.id === swapClash.mtId) : undefined;

  async function sendShift(force: boolean): Promise<void> {
    if (busy || !fromDate) return;
    if (!toDate.trim()) {
      reject(ct, 'FIELD_REQUIRED');
      return;
    }
    if (!shiftMovesLater(fromDate, toDate)) {
      reject(ct, 'FIELD_RANGE');
      return;
    }
    const problem = boundedReason(shiftReason, 2, 100);
    if (problem) {
      reject(ct, problem, problem === 'FIELD_LENGTH' ? { min: 2, max: 100 } : undefined);
      return;
    }
    const clash = await onShift({
      fromDate,
      toDate,
      reason: shiftReason.trim(),
      force,
    });
    setShiftClash(clash);
  }

  async function sendSwap(force: boolean): Promise<void> {
    if (busy || !matchA || !matchB) return;
    if (matchA.id === matchB.id) {
      reject(ct, 'FIELD_RANGE');
      return;
    }
    const problem = boundedReason(swapReason, 2, 100);
    if (problem) {
      reject(ct, problem, problem === 'FIELD_LENGTH' ? { min: 2, max: 100 } : undefined);
      return;
    }
    const clash = await onSwap({
      mtIdA: matchA.id,
      mtIdB: matchB.id,
      expectedRevA: matchA.rev,
      expectedRevB: matchB.rev,
      reason: swapReason.trim(),
      force,
    });
    setSwapClash(clash);
  }

  return (
    <>
      {choices.length > 0 ? (
        <CpCard>
          <h3 class="cpm-h">{ct('shiftDay')}</h3>
          <div class="cps-fields">
            <Select
              label={ct('schedMatchDay')}
              value={fromDate}
              disabled={busy}
              onValueChange={(value) => {
                setFromPick(value);
                setToDate((current) => (shiftMovesLater(value, current) ? current : ''));
                setShiftClash(null);
              }}
              options={choices.map((choice) => ({
                value: choice.date,
                label: shiftDayLabel(choice.date, choice.count, weekdays),
              }))}
            />
            <DateField
              id="cp-shift-date"
              label={ct('newDate')}
              value={toDate}
              disabled={busy}
              min={nextCalendarDay(fromDate)}
              onValueChange={(value) => {
                setToDate(value);
                setShiftClash(null);
              }}
            />
            <p class="cpm-preview">{ct('affected', { n: affected })}</p>
            <Textarea
              label={ct('shiftReason')}
              required
              value={shiftReason}
              maxLength={100}
              rows={2}
              variant="fixed"
              disabled={busy}
              onValueChange={(value) => {
                setShiftReason(value);
                setShiftClash(null);
              }}
            />
            {shiftClash ? (
              <p class="cpm-warn" role="alert">
                {clashSentence(shiftHit, shiftClash.type, ct('clashTeam'), ct('clashVenue'))}
              </p>
            ) : null}
            <div class="cps-actions">
              <Button variant="primary" disabled={busy} onClick={() => { void sendShift(false); }}>{ct('shiftOk')}</Button>
              {shiftClash ? (
                <Button variant="secondary" disabled={busy} onClick={() => { void sendShift(true); }}>{ct('forceShift')}</Button>
              ) : null}
            </div>
          </div>
        </CpCard>
      ) : null}
      {rows.length >= 2 ? (
        <CpCard>
          <h3 class="cpm-h">{ct('swapTwo')}</h3>
          <div class="cps-fields">
            <Select
              label={ct('swapFirst')}
              value={idA}
              disabled={busy}
              onValueChange={(value) => {
                setPickA(value);
                setSwapClash(null);
              }}
              options={rows.map((match) => ({ value: match.id, label: matchPickLabel(match) }))}
            />
            <Select
              label={ct('swapSecond')}
              value={idB}
              disabled={busy}
              onValueChange={(value) => {
                setPickB(value);
                setSwapClash(null);
              }}
              options={rows.map((match) => ({ value: match.id, label: matchPickLabel(match) }))}
            />
            {matchA && matchB && matchA.id !== matchB.id ? (
              <>
                <p class="cpm-swap">{swapPreview(matchA, matchB, ct('timeTbd'))}</p>
                <p class="cpm-swap">{swapPreview(matchB, matchA, ct('timeTbd'))}</p>
              </>
            ) : null}
            <Textarea
              label={ct('swapReason')}
              required
              value={swapReason}
              maxLength={100}
              rows={2}
              variant="fixed"
              disabled={busy}
              onValueChange={(value) => {
                setSwapReason(value);
                setSwapClash(null);
              }}
            />
            {swapClash ? (
              <p class="cpm-warn" role="alert">
                {clashSentence(swapHit, swapClash.type, ct('clashTeam'), ct('clashVenue'))}
              </p>
            ) : null}
            <div class="cps-actions">
              <Button variant="primary" disabled={busy} onClick={() => { void sendSwap(false); }}>{ct('swapOk')}</Button>
              {swapClash ? (
                <Button variant="secondary" disabled={busy} onClick={() => { void sendSwap(true); }}>{ct('forceSwap')}</Button>
              ) : null}
            </div>
          </div>
        </CpCard>
      ) : null}
    </>
  );
}
