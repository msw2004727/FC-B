import { describe, expect, it } from 'vitest';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { reasonText } from './feedback';

// 賽事 A 組 commit 1（顧問 §3.851）：後端代碼的文案與參數。
describe('A 組文案', () => {
  it('年齡不符：minAge、maxAge 都有才寫範圍，缺一個沿用原句', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    expect(reasonText(ct, 'AGE_NOT_ELIGIBLE', { minAge: 10, maxAge: 12 })).toBe('年齡不符合這個組別（限 10–12 歲）');
    expect(reasonText(ct, 'AGE_NOT_ELIGIBLE', { minAge: 10 })).toBe('年齡不符合這個組別');
    expect(reasonText(ct, 'AGE_NOT_ELIGIBLE', {})).toBe('年齡不符合這個組別');
  });

  it('報名上限講永久上限、結束講通用、補上的代碼不再是通用失敗句', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    expect(reasonText(ct, 'ENTRY_RETRY_LIMIT', { max: 3 })).toBe('這個俱樂部在這個組別已被拒絕或退出 3 次，不能再報名');
    expect(reasonText(ct, 'ENTRY_RETRY_LIMIT', { max: 3 })).not.toContain('稍後再試');
    expect(reasonText(ct, 'COMPETITION_ENDED')).toBe('賽事已結束，不能再修改');
    expect(reasonText(ct, 'TEAMS_RANGE', { count: 1, min: 2, max: 16 })).toBe('已核准的隊伍要有 2～16 隊才能排賽程');
    expect(reasonText(ct, 'COHOST_LIMIT', { max: 3 })).toBe('共同主辦已達 3 位上限');
    for (const code of ['ENTRY_NOT_APPROVED', 'NOT_DRAFT', 'ENTRY_NOT_FOUND', 'ENTRY_STATE', 'MATCH_STATE', 'STATUS_NOT_EDITABLE', 'COMPETITION_NOT_OPEN']) {
      expect(reasonText(ct, code), code).toContain('請重新整理');
    }
    for (const code of ['DIVISION_REQUIRED', 'PENALTY_MISMATCH', 'COMPETITION_NOT_FOUND', 'ALREADY_HOST', 'ALREADY_COHOST', 'INVITE_ISSUER_GONE', 'REASON_REQUIRED']) {
      expect(reasonText(ct, code), code).not.toBe('操作失敗，請稍後再試');
    }
    for (const code of ['MATCH_CORRUPT', 'TIMELINE_TOO_LONG', 'STANDING_CORRUPT']) {
      expect(reasonText(ct, code), code).toContain('首頁右下角按信封聯繫站長');
    }
  });
});
