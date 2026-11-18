import { describe, expect, it } from 'vitest';
import { buildAddInput, buildCreateInput, buildJoinInput, buildPaymentInput, buildRegisterInput, buildReviewInput, type WizardDraft } from './payload';

const draft: WizardDraft = {
  name: ' 示範盃 ',
  hostType: 'personal',
  hostTeamId: 'club_host',
  hostDisplay: '王示範',
  feeNote: '每隊報名費 3,000 元，賽前於領隊會議現場繳交。',
  regOpenAt: 1,
  regCloseAt: 2,
  firstMatchAt: 3,
  lastMatchAt: 4,
  venues: [{ name: '示範球場', address: '', lat: 25, lng: undefined, mapPlaceId: 'place_demo', mapProvider: 'google' }],
  divisions: [{
    name: '成人組',
    playersOnField: 5,
    maxTeams: 8,
    rosterMin: 7,
    rosterMax: 12,
    limitAge: false,
    minAge: 8,
    maxAge: 12,
    requireRealName: false,
    feePerTeam: 1500,
  }, {
    name: 'U12',
    playersOnField: 7,
    maxTeams: 6,
    rosterMin: 9,
    rosterMax: 14,
    limitAge: true,
    minAge: 8,
    maxAge: 12,
    requireRealName: true,
    feePerTeam: 0,
  }],
};

describe('送出欄位只含契約的鍵', () => {
  it('個人主辦不送 hostTeamId、feeNote、hostDisplay', () => {
    const input = buildCreateInput(draft);
    expect(input.hostType).toBe('personal');
    expect(input).not.toHaveProperty('hostTeamId');
    expect(input).not.toHaveProperty('feeNote');
    expect(input).not.toHaveProperty('hostDisplay');
    expect(input.liveLinks).toEqual([]);
    expect(input.venues[0]).toEqual({ name: '示範球場', mapPlaceId: 'place_demo', mapProvider: 'google' });
    expect(input.divisions[0]).not.toHaveProperty('minAge');
    expect(input.divisions[0]?.feePerTeam).toBe(1500);
    expect(input.divisions[1]?.feePerTeam).toBe(0);
    expect(input.divisions[1]?.minAge).toBe(8);
  });

  it('俱樂部主辦不送 hostDisplay，有繳費說明才送', () => {
    const input = buildCreateInput({ ...draft, hostType: 'club', hostDisplay: '不該出現' });
    expect(input).toMatchObject({ hostType: 'club', hostTeamId: 'club_host', feeNote: draft.feeNote });
    expect(input).not.toHaveProperty('hostDisplay');
  });

  it('自己登錄：成年送暱稱，未成年送真名與監護人同意，都不送 publicName', () => {
    expect(buildJoinInput({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', positionText: '',
      minor: false, nickname: '阿範', realName: '', guardianConsent: false,
    })).toEqual({ cid: 'cup', enId: 'en_a', number: 14, position: 'FW', nickname: '阿範', privacyAck: true });

    const minor = buildJoinInput({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', positionText: '',
      minor: true, nickname: '阿範', realName: '歐陽小明', guardianConsent: true,
    });
    expect(minor).toEqual({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽小明', guardianConsent: true,
    });
    expect(minor).not.toHaveProperty('publicName');
    expect(minor).not.toHaveProperty('nickname');
  });

  it('代填：成年沒暱稱不送暱稱，有暱稱才送；未成年不送暱稱；都不送 publicName', () => {
    const adult = buildAddInput({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', positionText: '',
      minor: false, nickname: '', realName: '王小範', guardianConsent: false,
      birthday: '1990-05-20',
    });
    expect(adult).toEqual({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王小範', birthday: '1990-05-20',
    });
    expect(adult).not.toHaveProperty('publicName');
    expect(adult).not.toHaveProperty('nickname');

    expect(buildAddInput({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', positionText: '',
      minor: false, nickname: '阿範', realName: '王小範', guardianConsent: false,
      birthday: '1990-05-20',
    })).toEqual({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王小範', nickname: '阿範', birthday: '1990-05-20',
    });

    const minor = buildAddInput({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', positionText: '',
      minor: true, nickname: '阿範', realName: '歐陽小明', guardianConsent: true,
      birthday: '2016-05-20',
    });
    expect(minor).toEqual({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽小明', guardianConsent: true, birthday: '2016-05-20',
    });
    expect(minor).not.toHaveProperty('nickname');
    expect(minor).not.toHaveProperty('publicName');
  });

  it('報隊、審核、繳費只送允許的鍵', () => {
    expect(buildRegisterInput({ cid: 'cup', dvId: 'dv_adult', teamId: 'club_a' })).toEqual({
      cid: 'cup', dvId: 'dv_adult', teamId: 'club_a',
    });
    expect(buildReviewInput({ cid: 'cup', enId: 'en_pa', decision: 'approve', reason: '不該出現' })).toEqual({
      cid: 'cup', enId: 'en_pa', decision: 'approve',
    });
    expect(buildReviewInput({ cid: 'cup', enId: 'en_pa', decision: 'reject', reason: ' 資料不足 ' })).toEqual({
      cid: 'cup', enId: 'en_pa', decision: 'reject', reason: '資料不足',
    });
    expect(buildPaymentInput({ cid: 'cup', enId: 'en_d', paid: true })).toEqual({
      cid: 'cup', enId: 'en_d', paymentStatus: 'paid',
    });
    expect(buildPaymentInput({ cid: 'cup', enId: 'en_d', paid: false }).paymentStatus).toBe('none');
  });
});
