import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SnapLike {
  exists: () => boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
}

const { fsMock, fbMock } = vi.hoisted(() => {
  const onSnapshot = vi.fn();
  const doc = vi.fn((_db: unknown, ..._segments: string[]) => ({ path: _segments }));
  const getFirebase = vi.fn(() => Promise.resolve({ db: { _mockDb: true } }));
  return {
    fsMock: {
      onSnapshot,
      doc,
      lastCallback: null as ((snap: SnapLike) => void) | null,
      lastUnsub: vi.fn() as unknown as () => void,
    },
    fbMock: { getFirebase },
  };
});

vi.mock('firebase/firestore', () => ({
  doc: fsMock.doc,
  onSnapshot: fsMock.onSnapshot,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: fbMock.getFirebase,
}));

import {
  _resetIdentitySettingsForTest,
  getIdentitySettings,
  setIdentitySettingsLocal,
  startIdentitySettings,
  stopIdentitySettings,
  subscribeIdentitySettings,
} from './identity-settings';
import { normalizeIdentitySettings } from './identity-resolver';

function makeSnap(
  exists: boolean,
  data?: Record<string, unknown>,
  id = 'settings',
): SnapLike {
  return {
    exists: () => exists,
    id,
    data: () => data,
  };
}

async function flush(times = 6): Promise<void> {
  // 動態 import（vi.mock）需要巨任務才會完成，只等微任務不夠。
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetIdentitySettingsForTest();
  fsMock.lastCallback = null;
  fsMock.lastUnsub = vi.fn();
  fsMock.onSnapshot.mockImplementation((_ref: unknown, cb: (snap: SnapLike) => void) => {
    fsMock.lastCallback = cb;
    return fsMock.lastUnsub;
  });
  fsMock.doc.mockImplementation((_db: unknown, ..._segments: string[]) => ({ path: _segments }));
  fbMock.getFirebase.mockResolvedValue({ db: { _mockDb: true } });
});

afterEach(() => {
  _resetIdentitySettingsForTest();
});

describe('M-123 identity-settings store', () => {
  it('start→snapshot→get：snapshot 到值才寫入 store', async () => {
    startIdentitySettings('u1');
    await flush();
    expect(fsMock.doc).toHaveBeenCalled();
    expect(fsMock.onSnapshot).toHaveBeenCalledTimes(1);
    expect(getIdentitySettings()).toBeNull();

    fsMock.lastCallback!(makeSnap(true, {
      profileActiveIdentityId: 'secondary',
      identities: { secondary: { enabled: true, displayName: '官方' } },
    }));
    expect(getIdentitySettings()?.identities.secondary?.displayName).toBe('官方');
    expect(getIdentitySettings()?.profileActiveIdentityId).toBe('secondary');
  });

  it('文件不存在 → null', async () => {
    setIdentitySettingsLocal(normalizeIdentitySettings({
      identities: { secondary: { enabled: true, displayName: '官方' } },
    }));
    expect(getIdentitySettings()).not.toBeNull();
    startIdentitySettings('u1');
    await flush();
    fsMock.lastCallback!(makeSnap(false));
    expect(getIdentitySettings()).toBeNull();
  });

  it('相同內容不重複通知', async () => {
    const listener = vi.fn();
    subscribeIdentitySettings(listener);
    startIdentitySettings('u1');
    await flush();
    const docData = {
      profileActiveIdentityId: 'secondary',
      identities: { secondary: { enabled: true, displayName: '官方' } },
    };
    fsMock.lastCallback!(makeSnap(true, docData));
    expect(listener).toHaveBeenCalledTimes(1);
    fsMock.lastCallback!(makeSnap(true, docData));
    expect(listener).toHaveBeenCalledTimes(1);
    fsMock.lastCallback!(makeSnap(true, { ...docData, profileActiveIdentityId: 'main' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stop 清 null 並通知；重複 stop 不重複通知', async () => {
    const listener = vi.fn();
    subscribeIdentitySettings(listener);
    startIdentitySettings('u1');
    await flush();
    fsMock.lastCallback!(makeSnap(true, {
      identities: { secondary: { enabled: true, displayName: '官方' } },
    }));
    expect(getIdentitySettings()).not.toBeNull();
    const beforeStop = listener.mock.calls.length;
    stopIdentitySettings();
    expect(getIdentitySettings()).toBeNull();
    expect(fsMock.lastUnsub).toHaveBeenCalled();
    expect(listener.mock.calls.length).toBe(beforeStop + 1);
    // 再次 stop 不重複通知（已經 null）
    stopIdentitySettings();
    expect(listener.mock.calls.length).toBe(beforeStop + 1);
  });

  it('換 uid 退訂舊監聽並重開', async () => {
    startIdentitySettings('u1');
    await flush();
    const firstUnsub = fsMock.lastUnsub;
    expect(fsMock.onSnapshot).toHaveBeenCalledTimes(1);
    startIdentitySettings('u2');
    await flush();
    expect(firstUnsub).toHaveBeenCalled();
    expect(fsMock.onSnapshot).toHaveBeenCalledTimes(2);
  });

  it('同 uid 重複呼叫不重開', async () => {
    startIdentitySettings('u1');
    await flush();
    startIdentitySettings('u1');
    await flush();
    expect(fsMock.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('stop 在 import 完成前呼叫不會留下監聽', async () => {
    startIdentitySettings('u1');
    // 不 await 直接 stop
    stopIdentitySettings();
    await flush();
    expect(fsMock.onSnapshot).not.toHaveBeenCalled();
  });

  it('setIdentitySettingsLocal 走同一份 JSON 比較（相同內容不通知）', () => {
    const listener = vi.fn();
    subscribeIdentitySettings(listener);
    const settings = normalizeIdentitySettings({
      identities: { secondary: { enabled: true, displayName: '官方' } },
    });
    setIdentitySettingsLocal(settings);
    expect(listener).toHaveBeenCalledTimes(1);
    setIdentitySettingsLocal(settings);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
