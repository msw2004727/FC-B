import { describe, expect, it } from 'vitest';
import { canSetCompetitionStatus, statusTargetsOf } from './status-access';

const OK_BASE = { status: 'published' as const, endedAt: null, hidden: false };
const HOST = { canHost: true, isAdmin: false };
const ADMIN = { canHost: true, isAdmin: true };

describe('canSetCompetitionStatus', () => {
  it('canHost=false 一律不行（即使管理員）', () => {
    expect(canSetCompetitionStatus(OK_BASE, { canHost: false, isAdmin: true })).toBe(false);
    expect(canSetCompetitionStatus(OK_BASE, { canHost: false, isAdmin: false })).toBe(false);
  });

  it('共同主辦傳 canHost=true 可以', () => {
    expect(canSetCompetitionStatus(OK_BASE, HOST)).toBe(true);
  });

  it('published 可以（主辦）', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, status: 'published' }, HOST)).toBe(true);
  });

  it('postponed 可以（主辦）', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, status: 'postponed' }, HOST)).toBe(true);
  });

  it('draft 不行', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, status: 'draft' }, HOST)).toBe(false);
  });

  it('cancelled 不行', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, status: 'cancelled' }, HOST)).toBe(false);
  });

  it('已結束（endedAt 有值）不行', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, endedAt: 1 }, HOST)).toBe(false);
  });

  it('刪除中（deletingAt 有值）不行', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, deletingAt: 1 }, HOST)).toBe(false);
  });

  it('hidden 時主辦不行，管理員可以', () => {
    expect(canSetCompetitionStatus({ ...OK_BASE, hidden: true }, HOST)).toBe(false);
    expect(canSetCompetitionStatus({ ...OK_BASE, hidden: true }, ADMIN)).toBe(true);
  });
});

describe('statusTargetsOf', () => {
  it('published → [postponed, cancelled]', () => {
    expect(statusTargetsOf('published')).toEqual(['postponed', 'cancelled']);
  });

  it('postponed → [published, cancelled]', () => {
    expect(statusTargetsOf('postponed')).toEqual(['published', 'cancelled']);
  });

  it('draft → []', () => {
    expect(statusTargetsOf('draft')).toEqual([]);
  });

  it('cancelled → []', () => {
    expect(statusTargetsOf('cancelled')).toEqual([]);
  });
});
