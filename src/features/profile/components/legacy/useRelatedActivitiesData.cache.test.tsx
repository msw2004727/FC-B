import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PROFILE-SPEED（MiMo A1）：報名／主辦數字的快取只墊「這個 uid 的第一次伺服器讀取」。
// 伺服器結果出現過之後，reload 或 retry 讓伺服器狀態回到 loading 時，不得再拿快取蓋掉較新的畫面。
const related = vi.hoisted(() => ({
  loadRelatedActivities: vi.fn(),
  loadRelatedActivitiesFromCache: vi.fn(),
}));

vi.mock('../../data/related-activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/related-activities')>();
  return {
    ...actual,
    loadRelatedActivities: related.loadRelatedActivities,
    loadRelatedActivitiesFromCache: related.loadRelatedActivitiesFromCache,
  };
});

import { useRelatedActivitiesData, type RelatedActivitiesData } from './LegacyProfileSocialAndRelated';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resultOf(registered: number): unknown {
  return { registered: [], hosted: [], counts: { registered, hosted: 0 } };
}

let latest: RelatedActivitiesData | null = null;
function Probe({ uid, cacheAllowed }: { uid: string; cacheAllowed: boolean }): null {
  latest = useRelatedActivitiesData(uid, cacheAllowed);
  return null;
}

function shown(): string {
  if (!latest) return 'none';
  const s = latest.state;
  if (s.status === 'ready') return `ready:${(s.data as { counts: { registered: number } }).counts.registered}`;
  return s.status;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

describe('useRelatedActivitiesData 快取墊底（PROFILE-SPEED）', () => {
  beforeEach(() => {
    latest = null;
    related.loadRelatedActivities.mockReset();
    related.loadRelatedActivitiesFromCache.mockReset();
  });
  afterEach(() => cleanup());

  it('快取先畫、伺服器到換新；之後 reload 伺服器讀取中不再顯示快取', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    related.loadRelatedActivities.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    related.loadRelatedActivitiesFromCache.mockResolvedValue(resultOf(1));

    render(<Probe uid="U-me" cacheAllowed />);
    await flush();
    expect(shown()).toBe('ready:1');

    await act(async () => {
      first.resolve(resultOf(5));
      await first.promise;
    });
    expect(shown()).toBe('ready:5');

    await act(async () => {
      latest?.reload();
    });
    await flush();
    expect(shown()).toBe('loading');

    await act(async () => {
      second.resolve(resultOf(6));
      await second.promise;
    });
    expect(shown()).toBe('ready:6');
    expect(related.loadRelatedActivitiesFromCache).toHaveBeenCalledTimes(1);
  });

  it('伺服器失敗後 retry：讀取中不再顯示快取', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    related.loadRelatedActivities.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    related.loadRelatedActivitiesFromCache.mockResolvedValue(resultOf(1));

    render(<Probe uid="U-me" cacheAllowed />);
    await flush();
    expect(shown()).toBe('ready:1');

    await act(async () => {
      first.reject(new Error('offline'));
      await first.promise.catch(() => undefined);
    });
    expect(shown()).toBe('error');

    await act(async () => {
      latest?.retry();
    });
    await flush();
    expect(shown()).toBe('loading');

    await act(async () => {
      second.resolve(resultOf(4));
      await second.promise;
    });
    expect(shown()).toBe('ready:4');
  });

  it('cacheAllowed=false（第一次在這台裝置開）不讀快取', async () => {
    const first = deferred<unknown>();
    related.loadRelatedActivities.mockReturnValueOnce(first.promise);
    related.loadRelatedActivitiesFromCache.mockResolvedValue(resultOf(1));

    render(<Probe uid="U-me" cacheAllowed={false} />);
    await flush();
    expect(shown()).toBe('loading');
    expect(related.loadRelatedActivitiesFromCache).not.toHaveBeenCalled();
  });
});
