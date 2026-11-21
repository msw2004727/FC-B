import { describe, expect, it } from 'vitest';
import {
  COMPETITIONS_DEFAULT_SOURCE,
  competitionSourceFromQuery,
  tournamentsSourcePath,
  withCompetitionSource,
} from './source';

// 站長 11-21 指示「預設是站內賽事」：沒有參數、不認得的參數都回到站內，?src=ext 仍是外部
// （取代顧問 §3.373「預設停在外部」）。
describe('賽事來源網址', () => {
  it('預設是站內；不認得的參數回到站內；?src=ext 仍解析為外部', () => {
    expect(COMPETITIONS_DEFAULT_SOURCE).toBe('in');
    expect(competitionSourceFromQuery(undefined)).toBe('in');
    expect(competitionSourceFromQuery(null)).toBe('in');
    expect(competitionSourceFromQuery('')).toBe('in');
    expect(competitionSourceFromQuery('nope')).toBe('in');
    expect(competitionSourceFromQuery('out')).toBe('in');
    expect(competitionSourceFromQuery('EXT')).toBe('in');
    expect(competitionSourceFromQuery('ext')).toBe('ext');
    expect(competitionSourceFromQuery('in')).toBe('in');
  });

  // 改寫：顧問 11-20 方案 2 條件 3 取代 §3.373「選到外部就拿掉 src」——點選後兩側都明確寫 ?src，
  // 預設改成因人而異後，點了外部重新整理或返回才不會被帶回站內。
  it('點選後兩側都明確寫 ?src，其餘參數保留', () => {
    expect(withCompetitionSource('', 'ext')).toBe('?src=ext');
    expect(withCompetitionSource('?src=in', 'ext')).toBe('?src=ext');
    expect(withCompetitionSource('?src=ext', 'ext')).toBe('?src=ext');
    expect(withCompetitionSource('?src=in&keep=1', 'ext')).toBe('?src=ext&keep=1');
    expect(withCompetitionSource('?keep=1', 'ext')).toBe('?keep=1&src=ext');
    expect(withCompetitionSource('', 'in')).toBe('?src=in');
    expect(withCompetitionSource('?keep=1', 'in')).toBe('?keep=1&src=in');
    expect(withCompetitionSource('?src=ext&keep=1', 'in')).toBe('?src=in&keep=1');
    expect(withCompetitionSource('src=nope&keep=1', 'in')).toBe('?src=in&keep=1');
    expect(tournamentsSourcePath('/tournaments', '?src=in', 'ext')).toBe('/tournaments?src=ext');
    expect(tournamentsSourcePath('/tournaments', '?keep=1', 'in')).toBe('/tournaments?keep=1&src=in');
  });
});
