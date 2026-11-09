import { describe, expect, it } from 'vitest';
import { options } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { render } from '@testing-library/preact';

// 對應 src/test-setup.ts 第 4 段：Preact effect 排程改用立即的 setTimeout，並在測試結束時沖掉。
describe('test-setup：Preact effect 排程掛鉤', () => {
  it('setup 已掛上 options.requestAnimationFrame', () => {
    expect(typeof options.requestAnimationFrame).toBe('function');
  });

  it('act 之外的非同步 setState，其 effect 在下一個計時器週期內就會執行', async () => {
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
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(seen).toEqual([0, 1]);
  });
});
