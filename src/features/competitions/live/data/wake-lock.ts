// 比賽進行中且畫面可見時，要求螢幕不要鎖定。失敗就標不支援。

import type { WakeState } from './types';

export interface WakeHandle {
  release(): Promise<void>;
  addEventListener?(type: 'release', cb: () => void): void;
}

export interface WakeEnv {
  request: (() => Promise<WakeHandle>) | null;
  active: () => boolean;
  visible: () => boolean;
  onChange: (state: WakeState) => void;
}

export function bindWakeLock(env: WakeEnv): { refresh: () => void; stop: () => void } {
  let stopped = false;
  let held: WakeHandle | null = null;
  let asking = false;

  async function ask(): Promise<void> {
    if (stopped || asking) return;
    if (!env.visible() || !env.active()) {
      env.onChange('off');
      if (held) {
        const current = held;
        held = null;
        await current.release().catch(() => undefined);
      }
      return;
    }
    if (!env.request) {
      env.onChange('unsupported');
      return;
    }
    if (held) {
      env.onChange('held');
      return;
    }
    asking = true;
    try {
      const handle = await env.request();
      if (stopped || !env.visible() || !env.active()) {
        await handle.release().catch(() => undefined);
        env.onChange('off');
        return;
      }
      held = handle;
      handle.addEventListener?.('release', () => {
        if (held === handle) held = null;
        if (!stopped) ask().catch(() => undefined);
      });
      env.onChange('held');
    } catch {
      env.onChange('unsupported');
    } finally {
      asking = false;
    }
  }

  return {
    refresh: () => {
      void ask();
    },
    stop: () => {
      stopped = true;
      const current = held;
      held = null;
      if (current) void current.release().catch(() => undefined);
      env.onChange('off');
    },
  };
}
