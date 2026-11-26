import type { Functions } from 'firebase/functions';

const SPORT_PREFS_CALL_TIMEOUT_MS = 10_000;

export interface SaveSportPrefsRequest {
  addSports?: string[];
  removeSport?: string;
  newEventNotify?: boolean;
  promptSeen?: true;
}

export interface SaveSportPrefsResult {
  favSports: string[];
  newEventNotify: boolean;
}

export type SportPrefsErrorCode =
  | 'invalid-argument'
  | 'resource-exhausted'
  | 'unauthenticated'
  | 'failed-precondition'
  | 'internal'
  | 'timeout';

const KNOWN_CODES: readonly SportPrefsErrorCode[] = [
  'invalid-argument',
  'resource-exhausted',
  'unauthenticated',
  'failed-precondition',
  'internal',
  'timeout',
];

export class SportPrefsCallError extends Error {
  readonly code: SportPrefsErrorCode;

  constructor(code: SportPrefsErrorCode) {
    super(code);
    this.name = 'SportPrefsCallError';
    this.code = code;
  }
}

export function toSportPrefsCallError(err: unknown): SportPrefsCallError {
  if (err instanceof SportPrefsCallError) return err;
  const raw = err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
    ? (err as { code: string }).code.replace(/^functions\//, '')
    : '';
  if (raw === 'deadline-exceeded') return new SportPrefsCallError('timeout');
  const hit = KNOWN_CODES.find((c) => c === raw);
  return new SportPrefsCallError(hit ?? 'internal');
}

export type SaveSportPrefsMockHandler = (data: Record<string, unknown>) => unknown | Promise<unknown>;

let mockHandler: SaveSportPrefsMockHandler | null = null;

export function registerSportPrefsMock(handler: SaveSportPrefsMockHandler): void {
  mockHandler = handler;
}

export function clearSportPrefsMocks(): void {
  mockHandler = null;
}

function isMockMode(): boolean {
  return import.meta.env.VITE_CALLABLE_MODE === 'mock';
}

async function liveTransport(data: Record<string, unknown>): Promise<unknown> {
  const [{ httpsCallable }, { getFirebase }] = await Promise.all([
    import('firebase/functions'),
    import('@/data/firebase'),
  ]);
  const ctx = await getFirebase();
  const callable = httpsCallable(ctx.functions as Functions, 'saveSportPrefs', { timeout: SPORT_PREFS_CALL_TIMEOUT_MS });
  const result = await callable(data);
  return result.data;
}

async function mockTransport(data: Record<string, unknown>): Promise<unknown> {
  if (!mockHandler) throw new SportPrefsCallError('internal');
  return mockHandler(data);
}

function whitelist(req: SaveSportPrefsRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (req.addSports !== undefined) out.addSports = req.addSports;
  if (req.removeSport !== undefined) out.removeSport = req.removeSport;
  if (req.newEventNotify !== undefined) out.newEventNotify = req.newEventNotify;
  if (req.promptSeen !== undefined) out.promptSeen = req.promptSeen;
  return out;
}

function validateResult(data: unknown): SaveSportPrefsResult {
  if (!data || typeof data !== 'object') throw new SportPrefsCallError('internal');
  const d = data as { favSports?: unknown; newEventNotify?: unknown };
  if (!Array.isArray(d.favSports) || !d.favSports.every((x) => typeof x === 'string')) {
    throw new SportPrefsCallError('internal');
  }
  if (typeof d.newEventNotify !== 'boolean') throw new SportPrefsCallError('internal');
  return { favSports: d.favSports as string[], newEventNotify: d.newEventNotify };
}

export async function saveSportPrefs(req: SaveSportPrefsRequest): Promise<SaveSportPrefsResult> {
  const data = whitelist(req);
  const transport = isMockMode() ? mockTransport : liveTransport;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SportPrefsCallError('timeout')), SPORT_PREFS_CALL_TIMEOUT_MS);
  });
  try {
    const raw = await Promise.race([transport(data), timeout]);
    return validateResult(raw);
  } catch (err) {
    throw toSportPrefsCallError(err);
  } finally {
    clearTimeout(timer);
  }
}
