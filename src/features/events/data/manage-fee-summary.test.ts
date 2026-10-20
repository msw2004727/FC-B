import { describe, expect, it } from 'vitest';
import type { RegistrationDoc } from './types';
import { computeManageFeeSummary, getEventRecordedFeeAmount } from './manage-fee-summary';

const reg = (userId: string, status = 'confirmed', companionId?: string): RegistrationDoc =>
  ({ userId, status, ...(companionId ? { companionId } : {}) }) as RegistrationDoc;
const att = (uid: string, type: string, companionId: string | null = null, status = 'active') =>
  ({ uid, type, companionId, status });

describe('getEventRecordedFeeAmount', () => {
  it('只有正數費用才算，取整數', () => {
    expect(getEventRecordedFeeAmount({ fee: 150.9 } as never)).toBe(150);
    expect(getEventRecordedFeeAmount({ fee: 0 } as never)).toBe(0);
    expect(getEventRecordedFeeAmount({ fee: 'abc' } as never)).toBe(0);
    expect(getEventRecordedFeeAmount(null)).toBe(0);
  });
});

describe('computeManageFeeSummary（A feeBox 算式）', () => {
  it('沒有費用不顯示', () => {
    expect(computeManageFeeSummary(0, [], [], 3)).toBeNull();
  });

  it('應收依正取報名數；實收依簽退（同人只算一次、含同行者與未報名本人）', () => {
    const regs = [reg('u1'), reg('u1', 'confirmed', 'c1'), reg('u2'), reg('u3', 'waitlisted')];
    const records = [
      att('u1', 'checkout'), att('u1', 'checkout'), // 重複只算一次
      att('u1', 'checkout', 'c1'), // 同行者
      att('u9', 'unreg'), att('u9', 'checkout'), // 未報名掃碼本人
      att('u2', 'checkout', null, 'removed'), // 已刪除不算
      att('u3', 'checkout'), // 候補不算
    ];
    expect(computeManageFeeSummary(100, regs, records, 0)).toEqual({ expected: 300, actual: 300, short: 0 });
  });

  it('讀不到報名時用卡片顯示的正取人數算應收', () => {
    expect(computeManageFeeSummary(200, [], [], 5)).toEqual({ expected: 1000, actual: 0, short: 1000 });
  });
});
