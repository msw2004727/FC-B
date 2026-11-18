import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyDiagLoadsBadge } from './LazyDiagLoadsBadge';

// 模組工廠只在真的 import('./DiagLoadsBadge') 時執行一次：用它證明正式站沒有發出動態載入（初審 F3）。
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock('./DiagLoadsBadge', () => {
  loads.count += 1;
  return { DiagLoadsBadge: () => <div class="fcb-diag-loads">diag</div> };
});

afterEach(() => {
  cleanup();
});

describe('LazyDiagLoadsBadge 是否發出動態載入', () => {
  it('非內測主機：完全不 import 角標模組', async () => {
    for (const hostname of ['toosterx.com', 'www.toosterx.com', 'localhost', 'next.toosterx.com.evil.test']) {
      const view = render(<LazyDiagLoadsBadge hostname={hostname} />);
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 20);
      });
      expect(view.container.innerHTML).toBe('');
      view.unmount();
    }
    expect(loads.count).toBe(0);
  });

  it('內測主機：import 一次並顯示', async () => {
    const view = render(<LazyDiagLoadsBadge hostname="next.toosterx.com" />);
    await waitFor(() => expect(view.container.querySelector('.fcb-diag-loads')).not.toBeNull());
    expect(loads.count).toBe(1);
  });
});
