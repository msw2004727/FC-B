// 同一手機兩個分頁：Web Locks 優先，沒有就用 BroadcastChannel 心跳。
// 兩種都沒有就照常記分；S1 仍保證同一個已取號的意圖不會寫兩次。

export interface LockManager {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => Promise<void> | void,
  ): Promise<void>;
}

export interface TabChannel {
  postMessage(data: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface HeldTab {
  role: 'owner' | 'blocked';
  release(): void;
}

const TAB_HINT = '這場已在另一個分頁記分';
export { TAB_HINT };

export async function acquireTabLock(input: {
  name: string;
  locks: LockManager | null;
  channel: TabChannel | null;
  tabId: string;
  wait: (ms: number) => Promise<void>;
}): Promise<HeldTab> {
  if (input.locks) return holdWebLock(input.locks, input.name);
  if (input.channel) return holdChannel(input.channel, input.tabId, input.wait);
  return { role: 'owner', release() {} };
}

function holdWebLock(locks: LockManager, name: string): Promise<HeldTab> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (held: HeldTab) => {
      if (settled) return;
      settled = true;
      resolve(held);
    };
    const pending = locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        finish({ role: 'blocked', release() {} });
        return;
      }
      let releaseLock: () => void = () => {};
      const untilRelease = new Promise<void>((done) => {
        releaseLock = done;
      });
      finish({ role: 'owner', release: releaseLock });
      await untilRelease;
    });
    pending.catch((err) => {
      if (!settled) reject(err);
    });
  });
}

async function holdChannel(channel: TabChannel, tabId: string, wait: (ms: number) => Promise<void>): Promise<HeldTab> {
  let sawOwner = false;
  let owner = false;
  const timer = { beat: 0 as ReturnType<typeof setInterval> | 0 };
  channel.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const msg = data as { type?: string; tabId?: string };
    if (!msg.tabId || msg.tabId === tabId) return;
    if (msg.type === 'owner' || msg.type === 'beat') sawOwner = true;
    if (msg.type === 'hello' && owner) channel.postMessage({ type: 'owner', tabId });
  };
  channel.postMessage({ type: 'hello', tabId });
  await wait(60);
  if (sawOwner) {
    return {
      role: 'blocked',
      release() {
        channel.onmessage = null;
        channel.close();
      },
    };
  }
  owner = true;
  channel.postMessage({ type: 'owner', tabId });
  timer.beat = setInterval(() => channel.postMessage({ type: 'beat', tabId }), 1000);
  return {
    role: 'owner',
    release() {
      owner = false;
      clearInterval(timer.beat);
      channel.onmessage = null;
      channel.close();
    },
  };
}
