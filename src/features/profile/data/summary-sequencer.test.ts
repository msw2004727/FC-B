import { describe, expect, it } from 'vitest';

import { createSummarySequencer } from './summary-sequencer';

describe('createSummarySequencer（summary 發出序號保護）', () => {
  it('序號遞增；較晚發出的請求先套用後，較早發出的晚到會被拒絕', () => {
    const seq = createSummarySequencer();
    const slow = seq.issue();
    const fresh = seq.issue();
    expect(fresh).toBeGreaterThan(slow);

    expect(seq.accept(fresh)).toBe(true);
    expect(seq.accept(slow)).toBe(false);
  });

  it('依發出順序回來都可以套用', () => {
    const seq = createSummarySequencer();
    const first = seq.issue();
    const second = seq.issue();
    expect(seq.accept(first)).toBe(true);
    expect(seq.accept(second)).toBe(true);
  });

  it('同一序號不能套用兩次', () => {
    const seq = createSummarySequencer();
    const token = seq.issue();
    expect(seq.accept(token)).toBe(true);
    expect(seq.accept(token)).toBe(false);
  });

  it('各個序號器互不影響', () => {
    const a = createSummarySequencer();
    const b = createSummarySequencer();
    const tokenA = a.issue();
    const tokenB = b.issue();
    expect(a.accept(tokenA)).toBe(true);
    expect(b.accept(tokenB)).toBe(true);
  });
});
