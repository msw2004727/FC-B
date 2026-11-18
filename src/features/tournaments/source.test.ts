import { describe, expect, it } from 'vitest';
import {
  COMPETITIONS_DEFAULT_SOURCE,
  competitionSourceFromQuery,
  tournamentsSourcePath,
  withCompetitionSource,
} from './source';

describe('賽事來源網址', () => {
  it('預設是站內；不認得的參數回到預設', () => {
    expect(COMPETITIONS_DEFAULT_SOURCE).toBe('in');
    expect(competitionSourceFromQuery(undefined)).toBe('in');
    expect(competitionSourceFromQuery(null)).toBe('in');
    expect(competitionSourceFromQuery('')).toBe('in');
    expect(competitionSourceFromQuery('nope')).toBe('in');
    expect(competitionSourceFromQuery('out')).toBe('in');
    expect(competitionSourceFromQuery('in')).toBe('in');
    expect(competitionSourceFromQuery('ext')).toBe('ext');
  });

  it('選到預設就拿掉 src，另一側才寫，其餘參數保留', () => {
    expect(withCompetitionSource('', 'in')).toBe('');
    expect(withCompetitionSource('?src=ext', 'in')).toBe('');
    expect(withCompetitionSource('?src=ext&keep=1', 'in')).toBe('?keep=1');
    expect(withCompetitionSource('?keep=1', 'ext')).toBe('?keep=1&src=ext');
    expect(withCompetitionSource('src=nope&keep=1', 'ext')).toBe('?src=ext&keep=1');
    expect(tournamentsSourcePath('/tournaments', '?src=ext', 'in')).toBe('/tournaments');
    expect(tournamentsSourcePath('/tournaments', '?keep=1', 'ext')).toBe('/tournaments?keep=1&src=ext');
  });
});
