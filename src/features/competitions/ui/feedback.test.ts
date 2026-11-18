import { describe, expect, it } from 'vitest';
import { CP_REASON_FALLBACK_KEY } from '../data/reasons';
import { reasonText } from './feedback';

describe('reasonText', () => {
  it('未知 reason 一定是通用失敗文案，不露出代碼', () => {
    const dict: Record<string, string> = {
      [CP_REASON_FALLBACK_KEY]: '操作失敗，請稍後再試',
      'competitions.reason.FIELD_REQUIRED': '還有必填項目沒填',
    };
    const t = (key: string) => dict[key] ?? key;
    expect(reasonText(t, 'FIELD_REQUIRED')).toBe('還有必填項目沒填');
    const unknown = reasonText(t, 'NOT_A_REAL_CODE');
    expect(unknown).toBe('操作失敗，請稍後再試');
    expect(unknown).not.toContain('NOT_A_REAL_CODE');
    const missing = reasonText((key) => key, 'LEAKED_CODE');
    expect(missing).toBe('操作失敗，請稍後再試');
    expect(missing).not.toContain('LEAKED_CODE');
  });
});
