import { describe, expect, it } from 'vitest';
import {
  COMPETITIONS_DEFAULT_SOURCE,
  competitionSourceFromQuery,
  tournamentsSourcePath,
  withCompetitionSource,
} from './source';

// 顧問 §3.373：預設停在外部，站內才寫 ?src=in；舊的 ?src=ext 仍可解析（取代原「預設站內、外部寫 ?src=ext」）。
describe('賽事來源網址', () => {
  it('預設是外部；不認得的參數回到外部；舊的 ?src=ext 仍解析為外部', () => {
    expect(COMPETITIONS_DEFAULT_SOURCE).toBe('ext');
    expect(competitionSourceFromQuery(undefined)).toBe('ext');
    expect(competitionSourceFromQuery(null)).toBe('ext');
    expect(competitionSourceFromQuery('')).toBe('ext');
    expect(competitionSourceFromQuery('nope')).toBe('ext');
    expect(competitionSourceFromQuery('out')).toBe('ext');
    expect(competitionSourceFromQuery('IN')).toBe('ext');
    expect(competitionSourceFromQuery('ext')).toBe('ext');
    expect(competitionSourceFromQuery('in')).toBe('in');
  });

  it('選到外部就拿掉 src，選站內才寫 ?src=in，其餘參數保留', () => {
    expect(withCompetitionSource('', 'ext')).toBe('');
    expect(withCompetitionSource('?src=in', 'ext')).toBe('');
    expect(withCompetitionSource('?src=ext', 'ext')).toBe('');
    expect(withCompetitionSource('?src=in&keep=1', 'ext')).toBe('?keep=1');
    expect(withCompetitionSource('?src=ext&keep=1', 'ext')).toBe('?keep=1');
    expect(withCompetitionSource('', 'in')).toBe('?src=in');
    expect(withCompetitionSource('?keep=1', 'in')).toBe('?keep=1&src=in');
    expect(withCompetitionSource('?src=ext&keep=1', 'in')).toBe('?src=in&keep=1');
    expect(withCompetitionSource('src=nope&keep=1', 'in')).toBe('?src=in&keep=1');
    expect(tournamentsSourcePath('/tournaments', '?src=in', 'ext')).toBe('/tournaments');
    expect(tournamentsSourcePath('/tournaments', '?keep=1', 'in')).toBe('/tournaments?keep=1&src=in');
  });
});
