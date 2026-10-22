/**
 * 「我的俱樂部申請」純函式（照 A `profile-data-history.js#_getTeamApplicationTimeMs`、
 * `_getMyLatestTeamApplications`、`_renderMyApplications`；顯示條件照
 * `profile-data-render.js#_showApplicationsCard`）。
 *
 * 全部為純函式，資料由呼叫端以附件 `inbox-repo.ts#normalizeInboxMessage` 正規化後餵入；
 * 本檔不觸 Firestore、不做 UI。
 */
import type { InboxMessage } from '@/features/inbox/data/inbox-repo';
import type { TeamDoc } from '@/features/clubs/data/types';

export type TeamApplicationStatus = 'pending' | 'approved' | 'rejected' | 'ignored';

export interface LatestTeamApplication {
  messageId: string;
  teamId: string;
  teamName: string;
  status: TeamApplicationStatus;
  timeMs: number;
}

export interface TeamApplicationContext {
  uid: string;
  /** 目前登入者已加入的俱樂部 ID（照 A `_getUserTeamIds`／fallback）。 */
  teamIds: string[];
  /** 現存俱樂部清單（照 A `ApiService.getTeams()`）。 */
  liveTeams: TeamDoc[];
}

export interface ApplicationStatusDisplay {
  label: string;
  color: string;
}

const DEFAULT_STATUS_DISPLAY: ApplicationStatusDisplay = {
  label: '審核中',
  color: 'var(--warning)',
};

const STATUS_DISPLAY: Record<TeamApplicationStatus, ApplicationStatusDisplay> = {
  pending: { label: '審核中', color: 'var(--warning)' },
  approved: { label: '已通過', color: 'var(--success)' },
  rejected: { label: '已拒絕', color: 'var(--danger)' },
  ignored: { label: '已逾期', color: 'var(--text-muted)' },
};

const KNOWN_STATUSES: readonly TeamApplicationStatus[] = [
  'pending',
  'approved',
  'rejected',
  'ignored',
];

/** 照 A `statusWeight`：approved／rejected／ignored 皆為 3、pending 為 2、其餘為 0。 */
const STATUS_WEIGHT: Record<string, number> = {
  approved: 3,
  rejected: 3,
  ignored: 3,
  pending: 2,
};

/** 照 A `_renderMyApplications` 的 `statusMap[m.actionStatus] || statusMap.pending`。 */
export function getApplicationStatusDisplay(
  status: TeamApplicationStatus | string | null | undefined,
): ApplicationStatusDisplay {
  const key = String(status ?? '').trim() as TeamApplicationStatus;
  if (!KNOWN_STATUSES.includes(key)) return DEFAULT_STATUS_DISPLAY;
  return STATUS_DISPLAY[key] ?? DEFAULT_STATUS_DISPLAY;
}

function normalizeStatus(raw: unknown): TeamApplicationStatus {
  const key = String(raw ?? '').trim() as TeamApplicationStatus;
  return KNOWN_STATUSES.includes(key) ? key : 'pending';
}

function readField(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

function readString(obj: unknown, key: string): string {
  const v = readField(obj, key);
  return typeof v === 'string' ? v : '';
}

/** 照 A `parseValue`（in `_getTeamApplicationTimeMs`）逐一分支。 */
function parseValue(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const toMillis = obj['toMillis'];
    if (typeof toMillis === 'function') {
      try {
        const v = (toMillis as () => unknown).call(value);
        return typeof v === 'number' ? v : 0;
      } catch {
        return 0;
      }
    }
    const seconds = obj['seconds'];
    if (typeof seconds === 'number') {
      const nanos = obj['nanoseconds'];
      const nn = typeof nanos === 'number' ? nanos : 0;
      return seconds * 1000 + Math.floor(nn / 1000000);
    }
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 照 A `_getTeamApplicationTimeMs`：
 *   1. `timestamp` → `createdAt`
 *   2. `time`（字串 "YYYY/MM/DD HH:MM"）
 *   3. `rejectedAt`
 */
export function getTeamApplicationTimeMs(
  msg: InboxMessage | null | undefined,
): number {
  const m: Record<string, unknown> = (msg ?? {}) as Record<string, unknown>;

  const direct = parseValue(m['timestamp']) || parseValue(m['createdAt']);
  if (direct) return direct;

  const timeStr = String(m['time'] ?? '').trim();
  if (timeStr) {
    const parts = timeStr.split(' ');
    const datePart = parts[0] ?? '';
    const timePart = parts[1] ?? '0:0';
    const dateTokens = datePart.split('/');
    const timeTokens = timePart.split(':');
    const y = Number(dateTokens[0]);
    const mo = Number(dateTokens[1]);
    const d = Number(dateTokens[2]);
    const h = Number(timeTokens[0]);
    const mi = Number(timeTokens[1]);
    const parsed = new Date(
      y,
      (mo || 1) - 1,
      d || 1,
      h || 0,
      mi || 0,
    ).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return parseValue(m['rejectedAt']);
}

/**
 * 照 A `_getMyLatestTeamApplications`：
 *   1. 只取 `actionType === 'team_join_request'`、`meta.applicantUid === uid`。
 *   2. 依 `groupId || id` 取「狀態權重優先、其次時間較新」的那一筆。
 *   3. 再依 `teamId || teamName || id` 取「時間較新、其次權重」的那一筆。
 *   4. 過濾：俱樂部仍存在、且自己尚未加入該俱樂部。
 *   5. 排序：時間倒序、再依名稱。
 */
export function getMyLatestTeamApplications(
  messages: InboxMessage[] | null | undefined,
  ctx: TeamApplicationContext,
): LatestTeamApplication[] {
  const uid = String(ctx.uid ?? '').trim();
  if (!uid) return [];

  const liveTeams = Array.isArray(ctx.liveTeams) ? ctx.liveTeams : [];
  const liveTeamIds = new Set(
    liveTeams.map((t) => readString(t, 'id').trim()).filter(Boolean),
  );
  const liveTeamNames = new Set(
    liveTeams.map((t) => readString(t, 'name').trim()).filter(Boolean),
  );
  const currentTeamIds = Array.isArray(ctx.teamIds) ? ctx.teamIds : [];

  const allMsgs = Array.isArray(messages) ? messages : [];

  // 1. groupId 去重：狀態權重優先、時間較新者取代。
  const groupMap = new Map<string, InboxMessage>();
  for (const msg of allMsgs) {
    if (msg.actionType !== 'team_join_request') continue;
    const meta = msg.meta;
    if (!meta || typeof meta !== 'object') continue;
    if (readString(meta, 'applicantUid') !== uid) continue;

    const groupKey = String(
      readString(meta, 'groupId') || (typeof msg.id === 'string' ? msg.id : ''),
    ).trim();
    const prev = groupMap.get(groupKey);
    if (!prev) {
      groupMap.set(groupKey, msg);
      continue;
    }
    const prevWeight = STATUS_WEIGHT[String(prev.actionStatus ?? '')] ?? 0;
    const nextWeight = STATUS_WEIGHT[String(msg.actionStatus ?? '')] ?? 0;
    const prevTime = getTeamApplicationTimeMs(prev);
    const nextTime = getTeamApplicationTimeMs(msg);
    if (nextWeight > prevWeight || (nextWeight === prevWeight && nextTime > prevTime)) {
      groupMap.set(groupKey, msg);
    }
  }

  // 2. teamId 去重：時間較新優先、其次權重。
  const teamMap = new Map<string, InboxMessage>();
  for (const msg of groupMap.values()) {
    const meta = msg.meta;
    const teamKey = String(
      readString(meta, 'teamId')
      || readString(meta, 'teamName')
      || (typeof msg.id === 'string' ? msg.id : ''),
    ).trim();
    const prev = teamMap.get(teamKey);
    if (!prev) {
      teamMap.set(teamKey, msg);
      continue;
    }
    const prevTime = getTeamApplicationTimeMs(prev);
    const nextTime = getTeamApplicationTimeMs(msg);
    const prevWeight = STATUS_WEIGHT[String(prev.actionStatus ?? '')] ?? 0;
    const nextWeight = STATUS_WEIGHT[String(msg.actionStatus ?? '')] ?? 0;
    if (nextTime > prevTime || (nextTime === prevTime && nextWeight > prevWeight)) {
      teamMap.set(teamKey, msg);
    }
  }

  // 3. 過濾：俱樂部仍存在、且自己尚未加入。
  const filtered = Array.from(teamMap.values()).filter((msg) => {
    const meta = msg.meta;
    const teamId = readString(meta, 'teamId').trim();
    const teamName = readString(meta, 'teamName').trim();
    const teamExists = teamId
      ? liveTeamIds.has(teamId)
      : !!teamName && liveTeamNames.has(teamName);
    if (!teamExists) return false;
    if (teamId && currentTeamIds.includes(teamId)) return false;
    if (!teamId && teamName) {
      const matched = liveTeams.find((t) => readString(t, 'name').trim() === teamName);
      if (matched && currentTeamIds.includes(readString(matched, 'id').trim())) return false;
    }
    return true;
  });

  // 4. 排序：時間倒序、再依名稱。
  filtered.sort((a, b) => {
    const diff = getTeamApplicationTimeMs(b) - getTeamApplicationTimeMs(a);
    if (diff !== 0) return diff;
    return readString(a.meta, 'teamName').localeCompare(readString(b.meta, 'teamName'));
  });

  return filtered.map((msg) => {
    const meta = msg.meta;
    return {
      messageId: typeof msg.id === 'string' ? msg.id : '',
      teamId: readString(meta, 'teamId').trim(),
      teamName: readString(meta, 'teamName') || '-',
      status: normalizeStatus(msg.actionStatus),
      timeMs: getTeamApplicationTimeMs(msg),
    };
  });
}
