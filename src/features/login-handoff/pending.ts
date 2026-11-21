export const STORAGE_KEY = 'fcb:login-handoff';

export const HANDOFF_TTL_MS = 5 * 60 * 1000;
export const PENDING_DISCARD_MS = 6 * 60 * 1000;

const SECRET_RE = /^[0-9a-f]{64}$/;

export interface PendingHandoff {
  secret: string;
  createdAt: number;
}

export function readPending(): PendingHandoff | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const pending = parsePending(raw);
  if (!pending || Date.now() - pending.createdAt > PENDING_DISCARD_MS) {
    clearPending();
    return null;
  }
  return pending;
}

export function writePending(pending: PendingHandoff): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      secret: pending.secret,
      createdAt: pending.createdAt,
    }));
  } catch {
    /* ignore */
  }
}

export function clearPending(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function parsePending(raw: string): PendingHandoff | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const secret = (value as { secret?: unknown }).secret;
  const createdAt = (value as { createdAt?: unknown }).createdAt;
  if (typeof secret !== 'string' || !SECRET_RE.test(secret)) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return { secret, createdAt };
}
