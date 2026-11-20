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
  /** 0 到 1。退讓時間用。沒給就用 Math.random。 */
  random?: () => number;
  /** 選完之後角色再變（owner 心跳消失、重新競爭贏了）才會呼叫。 */
  onRole?: (role: 'owner' | 'blocked') => void;
}): Promise<HeldTab> {
  if (input.locks) return holdWebLock(input.locks, input.name);
  if (input.channel) {
    return holdChannel(input.channel, input.tabId, input.wait, input.random ?? Math.random, input.onRole);
  }
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

const HEARTBEAT_MS = 1000;
const SILENCE_MS = 3000;

function readClaim(data: unknown): { type: 'claim' | 'owner' | 'beat'; tabId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as { type?: unknown; tabId?: unknown };
  if (msg.type !== 'claim' && msg.type !== 'owner' && msg.type !== 'beat') return null;
  if (typeof msg.tabId !== 'string' || msg.tabId.length === 0) return null;
  return { type: msg.type, tabId: msg.tabId };
}

function highestId(ids: Iterable<string>): string {
  let best = '';
  for (const id of ids) {
    if (best === '' || id > best) best = id;
  }
  return best;
}

/**
 * 沒有 Web Locks 時：先宣告，隨機退讓，再用 id 大小定誰當 owner。
 * owner 看到優先權較高（id 較大）的 owner 宣告或心跳就立刻讓位並重新選舉。
 * 心跳消失才重新競爭。同時啟動的兩個分頁只會有一個 owner。
 */
async function holdChannel(
  channel: TabChannel,
  tabId: string,
  wait: (ms: number) => Promise<void>,
  random: () => number,
  onRole?: (role: 'owner' | 'blocked') => void,
): Promise<HeldTab> {
  const claims = new Set<string>([tabId]);
  let foreignOwner: string | null = null;
  let owner = false;
  let released = false;
  let settled = false;
  let lastOwnerAt = 0;
  let blockedAt = 0;
  let generation = 0;
  let beatTimer: ReturnType<typeof setInterval> | 0 = 0;
  let silenceTimer: ReturnType<typeof setInterval> | 0 = 0;

  const post = (type: 'claim' | 'owner' | 'beat') => {
    if (released) return;
    channel.postMessage({ type, tabId });
  };
  const stopBeat = () => {
    if (beatTimer) clearInterval(beatTimer);
    beatTimer = 0;
  };
  const stopSilence = () => {
    if (silenceTimer) clearInterval(silenceTimer);
    silenceTimer = 0;
  };

  const becomeOwner = () => {
    if (released || owner) return;
    owner = true;
    foreignOwner = null;
    stopSilence();
    post('owner');
    beatTimer = setInterval(() => post('beat'), HEARTBEAT_MS);
    if (settled) onRole?.('owner');
  };

  const armSilence = () => {
    if (silenceTimer || released) return;
    silenceTimer = setInterval(() => {
      if (released || owner) return;
      const heard = foreignOwner != null && Date.now() - lastOwnerAt < SILENCE_MS;
      const waiting = foreignOwner == null && Date.now() - blockedAt < SILENCE_MS;
      if (heard || waiting) return;
      foreignOwner = null;
      claims.clear();
      claims.add(tabId);
      void elect();
    }, HEARTBEAT_MS);
  };

  const becomeBlocked = () => {
    if (released || owner) return;
    blockedAt = Date.now();
    armSilence();
    if (settled) onRole?.('blocked');
  };

  const stepDown = (otherId: string) => {
    foreignOwner = otherId;
    lastOwnerAt = Date.now();
    if (!owner) return;
    owner = false;
    stopBeat();
    generation += 1;
    if (settled) onRole?.('blocked');
    armSilence();
    void elect();
  };

  channel.onmessage = (event) => {
    const msg = readClaim(event.data);
    if (!msg || msg.tabId === tabId) return;
    if (msg.type === 'claim') {
      claims.add(msg.tabId);
      if (owner) post('owner');
      return;
    }
    if (owner && msg.tabId > tabId) {
      stepDown(msg.tabId);
      return;
    }
    if (!owner) {
      foreignOwner = msg.tabId;
      lastOwnerAt = Date.now();
    }
  };

  const elect = async (): Promise<void> => {
    if (released || owner) return;
    const ticket = ++generation;
    const unit = Math.min(0.999, Math.max(0, random()));
    const backoff = 40 + Math.floor(unit * 40);
    post('claim');
    await wait(backoff);
    if (released || owner || ticket !== generation) return;
    if (foreignOwner) {
      becomeBlocked();
      return;
    }
    post('claim');
    await wait(80);
    if (released || owner || ticket !== generation) return;
    if (foreignOwner) {
      becomeBlocked();
      return;
    }
    if (highestId(claims) !== tabId) {
      becomeBlocked();
      return;
    }
    becomeOwner();
  };

  await elect();
  settled = true;

  return {
    role: owner ? 'owner' : 'blocked',
    release() {
      released = true;
      owner = false;
      generation += 1;
      stopBeat();
      stopSilence();
      channel.onmessage = null;
      channel.close();
    },
  };
}
