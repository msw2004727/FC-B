import { describe, expect, it } from 'vitest';
import { options } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { render, waitFor } from '@testing-library/preact';

// 對應 src/test-setup.ts 第 4 段：Preact effect 排程改用立即的 setTimeout，並在測試結束時沖掉。
describe('test-setup：Preact effect 排程掛鉤', () => {
  it('setup 已掛上 options.requestAnimationFrame', () => {
    expect(typeof options.requestAnimationFrame).toBe('function');
  });

  it('act 之外的非同步 setState，其 effect 很快就會執行', async () => {
    const seen: number[] = [];
    let bump: (() => void) | undefined;
    function Probe() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      useEffect(() => { seen.push(n); }, [n]);
      return <span>{n}</span>;
    }
    render(<Probe />);
    expect(seen).toEqual([0]);
    bump?.();
    await waitFor(() => expect(seen).toEqual([0, 1]));
  });

  // 下面兩案依檔內順序執行：前一案故意不等 effect，交給 setup 的 afterEach 同步沖掉；後一案確認真的被沖掉。
  const handoff = { ran: false };
  it('（交棒）排進 effect 但不等待', () => {
    let bump: (() => void) | undefined;
    function Probe() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      useEffect(() => { if (n === 1) handoff.ran = true; }, [n]);
      return <span>{n}</span>;
    }
    render(<Probe />);
    bump?.();
    expect(handoff.ran).toBe(false);
  });

  it('（交棒）上一案未等待的 effect 已在 afterEach 被沖掉', () => {
    expect(handoff.ran).toBe(true);
  });
});
