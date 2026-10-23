import { useEffect, useRef, useState } from 'preact/hooks';

import { on } from '@/core/events';
import { readQaClaims } from '@/data/auth';

export const QA_PERSONA_KEYS = ['captain', 'coach', 'venueOwner', 'memberA', 'memberB'] as const;
export type QaPersonaKey = (typeof QA_PERSONA_KEYS)[number];

export function isQaPersonaKey(value: unknown): value is QaPersonaKey {
  return typeof value === 'string' && QA_PERSONA_KEYS.some((key) => key === value);
}

export interface QaSessionView {
  /** claims.qaPersona；伺服器未帶時為空字串。 */
  persona: string;
  agent: string | null;
}

export async function loadQaSession(expectedUid?: string): Promise<QaSessionView | null> {
  const claims = await readQaClaims(expectedUid);
  if (claims === null) return null;
  return {
    persona: claims.persona ?? '',
    agent: claims.agent,
  };
}

/**
 * 目前登入者的 QA 狀態。uid 由呼叫端傳入（App 既有的 viewer），這裡不再自己讀 viewer。
 * undefined＝尚未確定（uid 未到位或 claims 讀取中）、null＝不是 QA 或未登入。
 * 橫幅在 undefined 與 null 都不顯示。
 */
export function useQaSession(uid: string | null | undefined): QaSessionView | null | undefined {
  const latest = useRef({ uid, version: 0 });
  const [snapshot, setSnapshot] = useState<{
    uid: typeof uid;
    version: number;
    value: QaSessionView | null | undefined;
  } | null>(null);

  // render 即失效，避免 uid 已切換但 effect 尚未清理時提交舊帳號結果。
  if (latest.current.uid !== uid) {
    latest.current = { uid, version: latest.current.version + 1 };
  }

  useEffect(() => {
    let active = true;

    async function reload(): Promise<void> {
      if (!active || latest.current.uid !== uid) return;
      const version = ++latest.current.version;
      if (uid == null) {
        setSnapshot({ uid, version, value: uid === null ? null : undefined });
        return;
      }

      setSnapshot({ uid, version, value: undefined });
      let value: QaSessionView | null;
      try {
        value = await loadQaSession(uid);
      } catch {
        value = null;
      }

      if (
        !active ||
        latest.current.uid !== uid ||
        latest.current.version !== version
      ) {
        return;
      }
      setSnapshot({ uid, version, value });
    }

    const unsubscribe = on('auth:changed', ({ uid: changedUid }) => {
      if (!active) return;

      // 事件上的 uid 和這次渲染的不同：先撤銷舊結果，等呼叫端把新 uid 傳進來再讀。
      if (changedUid !== uid || latest.current.uid !== uid) {
        const version = ++latest.current.version;
        setSnapshot({ uid, version, value: undefined });
        return;
      }

      void reload();
    });

    // 訂閱後補讀，避免 render 到 effect 之間的事件留下舊狀態。
    void reload();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [uid]);

  if (uid === null) return null;
  if (
    uid === undefined ||
    snapshot === null ||
    snapshot.uid !== uid ||
    snapshot.version !== latest.current.version
  ) {
    return undefined;
  }
  return snapshot.value;
}
