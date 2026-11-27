import { callFn, registerMock, clearMocks } from '@/data/callables';
import type { SaveSportPrefsRequest as ContractRequest } from '@/data/contract/callables';

const SPORT_PREFS_CALL_TIMEOUT_MS = 10_000;

export interface SaveSportPrefsRequest {
  addSports?: string[];
  removeSport?: string;
  removeSports?: string[];
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

/** 截圖台與測試用：VITE_CALLABLE_MODE=mock 時由 callFn 呼叫（走共用 mock 登錄）。 */
export function registerSportPrefsMock(handler: SaveSportPrefsMockHandler): void {
  registerMock('saveSportPrefs', async (req) => handler(req as unknown as Record<string, unknown>) as never);
}

export function clearSportPrefsMocks(): void {
  clearMocks();
}

/** 走共用 callFn（契約登錄、emulator 模式禁打正式 Functions、mock 模式），取代原本直接 httpsCallable（顧問 §3.809）。 */
async function transport(data: Record<string, unknown>): Promise<unknown> {
  return callFn('saveSportPrefs', data as unknown as ContractRequest, { timeout: SPORT_PREFS_CALL_TIMEOUT_MS });
}

function whitelist(req: SaveSportPrefsRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (req.addSports !== undefined) out.addSports = req.addSports;
  if (req.removeSport !== undefined) out.removeSport = req.removeSport;
  if (req.removeSports !== undefined) out.removeSports = req.removeSports;
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
