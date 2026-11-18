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
  it('個人主辦不送 hostTeamId 與 feeNote', () => {
    const input = buildCreateInput(draft);
    expect(input.hostType).toBe('personal');
    expect(input).not.toHaveProperty('hostTeamId');
    expect(input).not.toHaveProperty('feeNote');
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

  it('自己登錄：成年送暱稱，未成年送姓氏與監護人同意', () => {
    expect(buildJoinInput({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', positionText: '',
      minor: false, nickname: '阿範', realName: '', publicName: '', guardianConsent: false,
    })).toEqual({ cid: 'cup', enId: 'en_a', number: 14, position: 'FW', nickname: '阿範', privacyAck: true });

    expect(buildJoinInput({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', positionText: '',
      minor: true, nickname: '阿範', realName: '歐陽示範', publicName: '歐陽', guardianConsent: true,
    })).toEqual({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽示範', publicName: '歐陽', guardianConsent: true,
    });
  });

  it('代填：成年選姓氏送 publicName，改暱稱就不送 publicName；未成年不送暱稱', () => {
    expect(buildAddInput({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', positionText: '',
      minor: false, nickname: '', realName: '王示範', publicName: '王', guardianConsent: false,
      birthday: '1990-05-20', nicknameOverrides: false,
    })).toEqual({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王示範', publicName: '王', birthday: '1990-05-20',
    });

    expect(buildAddInput({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', positionText: '',
      minor: false, nickname: '阿範', realName: '王示範', publicName: '王', guardianConsent: false,
      birthday: '1990-05-20', nicknameOverrides: true,
    })).toEqual({
      cid: 'cup', enId: 'en_a', number: 10, position: 'MF', privacyAck: true,
      realName: '王示範', nickname: '阿範', birthday: '1990-05-20',
    });

    const minor = buildAddInput({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', positionText: '',
      minor: true, nickname: '阿範', realName: '歐陽示範', publicName: '歐陽', guardianConsent: true,
      birthday: '2016-05-20', nicknameOverrides: false,
    });
    expect(minor).toEqual({
      cid: 'cup', enId: 'en_a', number: 14, position: 'FW', privacyAck: true,
      realName: '歐陽示範', publicName: '歐陽', guardianConsent: true, birthday: '2016-05-20',
    });
    expect(minor).not.toHaveProperty('nickname');
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
