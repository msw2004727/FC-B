import { describe, expect, it } from 'vitest';
import type { ConfirmedRosterPerson } from './attendance-roster-model';
import { buildCompanionRowMeta, ownerInitial } from './companion-groups';

function row(partial: Partial<ConfirmedRosterPerson> & Pick<ConfirmedRosterPerson, 'uid' | 'displayName'>): ConfirmedRosterPerson {
  return {
    name: partial.displayName,
    isCompanion: false,
    hasSelfReg: true,
    proxyOnly: false,
    displayBadges: [],
    teamKey: null,
    regDocId: null,
    teamReservationTeamId: null,
    teamReservationTeamName: null,
    teamSeatSource: null,
    ...partial,
  };
}

function self(uid: string, displayName: string): ConfirmedRosterPerson {
  return row({ uid, displayName, isCompanion: false, hasSelfReg: true, proxyOnly: false });
}

function leadProxy(uid: string, displayName: string, flags: { proxyOnly?: boolean; isProxyOnly?: boolean } = {}): ConfirmedRosterPerson {
  return row({
    uid,
    displayName,
    isCompanion: false,
    hasSelfReg: false,
    proxyOnly: flags.proxyOnly ?? true,
    isProxyOnly: flags.isProxyOnly ?? true,
  });
}

function mate(uid: string, displayName: string, ownerUid: string): ConfirmedRosterPerson {
  return row({
    uid, displayName, ownerUid, isCompanion: true, hasSelfReg: false, proxyOnly: false,
  });
}

describe('buildCompanionRowMeta', () => {
  it('一般列是 solo，不占組色', () => {
    const meta = buildCompanionRowMeta([self('u1', 'Solo'), self('u2', 'Other')]);
    expect(meta).toEqual([
      { kind: 'solo', slot: 0 },
      { kind: 'solo', slot: 0 },
    ]);
  });

  it('lead 緊接 2 位同行者：mateCount、connected、last', () => {
    const meta = buildCompanionRowMeta([
      self('alice', 'Alice'),
      mate('k1', 'Kid One', 'alice'),
      mate('k2', 'Kid Two', 'alice'),
    ]);
    expect(meta[0]).toEqual({ kind: 'lead', slot: 0, mateCount: 2 });
    expect(meta[1]).toEqual({
      kind: 'mate', slot: 0, ownerInitial: 'A', connected: true, last: false, dashed: false,
    });
    expect(meta[2]).toEqual({
      kind: 'mate', slot: 0, ownerInitial: 'A', connected: true, last: true, dashed: false,
    });
  });

  it('proxyLead 緊接 2 位：虛線組，isProxyOnly 單獨也算代報', () => {
    const meta = buildCompanionRowMeta([
      leadProxy('wang', '王志明'),
      mate('b1', '王小寶', 'wang'),
      mate('b2', '王小貝', 'wang'),
      leadProxy('only-flag', 'Flag', { proxyOnly: false, isProxyOnly: true }),
    ]);
    expect(meta[0]).toEqual({ kind: 'proxyLead', slot: 0, mateCount: 2 });
    // 測試同步更新：小頭像中文名取第二字（王志明→志，Opus 審 P2-3）
    expect(meta[1]).toMatchObject({ kind: 'mate', connected: true, last: false, dashed: true, ownerInitial: '志' });
    expect(meta[2]).toMatchObject({ kind: 'mate', connected: true, last: true, dashed: true, ownerInitial: '志' });
    expect(meta[3]).toEqual({ kind: 'proxyLead', slot: 1, mateCount: 0 });
  });

  it('顏色依 lead／proxyLead 出現順序循環，第 5 組回到 0，solo 不占號', () => {
    const rows: ConfirmedRosterPerson[] = [self('solo', 'Solo')];
    for (let i = 0; i < 5; i += 1) {
      if (i === 2) rows.push(leadProxy(`p${i}`, `Proxy${i}`), mate(`c${i}`, `Kid${i}`, `p${i}`));
      else rows.push(self(`u${i}`, `Lead${i}`), mate(`c${i}`, `Kid${i}`, `u${i}`));
      if (i === 0) rows.push(self('mid', 'Mid'));
    }
    const slots = buildCompanionRowMeta(rows)
      .filter((meta) => meta.kind === 'lead' || meta.kind === 'proxyLead')
      .map((meta) => meta.slot);
    expect(slots).toEqual([0, 1, 2, 3, 0]);
  });

  it('找不到 owner 的同行者是孤兒', () => {
    const meta = buildCompanionRowMeta([
      self('other', 'Other'),
      mate('ghost', '小寶', 'missing'),
    ]);
    expect(meta[1]).toEqual({
      kind: 'mate', slot: 0, ownerInitial: '?', connected: false, last: false, dashed: false,
    });
  });

  it('分隊打散時 connected=false，last 只算還連著的最後一位', () => {
    const meta = buildCompanionRowMeta([
      self('alice', 'Alice'),
      mate('k1', '近', 'alice'),
      self('bob', 'Bob'),
      mate('k2', '遠', 'alice'),
    ]);
    expect(meta[0]).toMatchObject({ kind: 'lead', mateCount: 1, slot: 0 });
    expect(meta[1]).toMatchObject({ kind: 'mate', connected: true, last: true, ownerInitial: 'A' });
    expect(meta[2]).toEqual({ kind: 'solo', slot: 0 });
    expect(meta[3]).toMatchObject({
      kind: 'mate', connected: false, last: false, ownerInitial: 'A', slot: 0, dashed: false,
    });
  });

  it('標頭與一般報名分隔列打斷連線，另一側仍認得到主報名人', () => {
    const header = row({
      uid: 'h', displayName: '球隊', isTeamHeader: true, hasSelfReg: false, isCompanion: false, proxyOnly: false,
    });
    const separator = row({
      uid: 'sep', displayName: '一般報名', isTeamGeneralSeparator: true,
      hasSelfReg: false, isCompanion: false, proxyOnly: false,
    });
    const meta = buildCompanionRowMeta([
      self('alice', 'Alice'),
      mate('k1', '近', 'alice'),
      header,
      mate('k2', '遠', 'alice'),
      separator,
      self('bob', 'Bob'),
      mate('k3', 'BobKid', 'bob'),
    ]);
    expect(meta[1]).toMatchObject({ connected: true, last: true });
    expect(meta[2]).toEqual({ kind: 'solo', slot: 0 });
    expect(meta[3]).toMatchObject({ kind: 'mate', connected: false, ownerInitial: 'A', slot: 0 });
    expect(meta[4]).toEqual({ kind: 'solo', slot: 0 });
    expect(meta[5]).toMatchObject({ kind: 'lead', slot: 1, mateCount: 1 });
    expect(meta[6]).toMatchObject({ connected: true, last: true, ownerInitial: 'B' });
  });

  it('initial 取字：中文略過姓取第二字、單字中文、英文大寫、空字串 ?', () => {
    expect(ownerInitial('陳思妤')).toBe('思');
    expect(ownerInitial('王志明')).toBe('志');
    expect(ownerInitial('阿凱')).toBe('凱');
    expect(ownerInitial('寶')).toBe('寶');
    expect(ownerInitial('6-051范揚智')).toBe('6');
    expect(ownerInitial('alice')).toBe('A');
    expect(ownerInitial('')).toBe('?');
    const meta = buildCompanionRowMeta([
      self('zh', '陳思妤'),
      mate('a', '阿凱', 'zh'),
      self('en', 'alice'),
      mate('b', 'Kid', 'en'),
      self('empty', ''),
      mate('c', 'Kid', 'empty'),
    ]);
    expect(meta[1]).toMatchObject({ ownerInitial: '思' });
    expect(meta[3]).toMatchObject({ ownerInitial: 'A' });
    expect(meta[5]).toMatchObject({ ownerInitial: '?' });
  });

  it('同一 uid 有兩列（例如課程連動）：相連的同行者跟最近那一列的組色，不是第一次出現那列', () => {
    const meta = buildCompanionRowMeta([
      self('u', '甲乙'),
      mate('a', 'x', 'u'),
      self('v', '丙丁'),
      self('u', '甲乙'),
      mate('b', 'y', 'u'),
    ]);
    expect(meta[0]).toMatchObject({ kind: 'lead', slot: 0 });
    expect(meta[3]).toMatchObject({ kind: 'lead', slot: 1 });
    expect(meta[4]).toMatchObject({ kind: 'mate', connected: true, slot: 1 });
  });
});
