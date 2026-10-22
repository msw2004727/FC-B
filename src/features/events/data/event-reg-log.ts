import { getFirebase } from '@/data/firebase';

export interface RegLogRegistration {
  companionName?: unknown;
  userName?: unknown;
  registeredAt?: unknown;
  status?: unknown;
  cancelledAt?: unknown;
}

export interface RegLogOperation {
  id: string;
  type?: unknown;
  createdAt?: unknown;
  time?: unknown;
  content?: unknown;
}

export type RegLogAction = 'register' | 'cancel' | 'promote' | 'demote' | 'team';

export interface RegLogEntry {
  ms: number;
  userName: string;
  action: RegLogAction;
  label: string;
  actionClass: 'reg' | 'cancel' | 'promote' | 'demote';
}

const OPERATIONS = {
  force_promote: { action: 'promote', label: '手動正取' },
  auto_promote: { action: 'promote', label: '自動遞補' },
  force_demote: { action: 'demote', label: '下放候補' },
  capacity_demote: { action: 'demote', label: '容量降級' },
  team_reservation_create: { action: 'team', label: '建立席位' },
  team_reservation_update: { action: 'team', label: '調整席位' },
  team_reservation_cancel: { action: 'team', label: '取消席位' },
} as const;

/** 照 A `openEventRegLogModal` 的 `_toMs`。 */
export function regLogTimeMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.toMillis === 'function') {
      try {
        return (record.toMillis as () => number).call(value);
      } catch {
        // 照 A：繼續嘗試下一種時間格式。
      }
    }
    if (typeof record.toDate === 'function') {
      try {
        return (record.toDate as () => Date).call(value).getTime();
      } catch {
        // 照 A：繼續嘗試 seconds。
      }
    }
    const seconds = record.seconds || record._seconds;
    if (typeof seconds === 'number') {
      return seconds * 1000
        + Math.floor(Number(record.nanoseconds || record._nanoseconds || 0) / 1_000_000);
    }
  }
  const result = new Date(String(value)).getTime();
  return Number.isFinite(result) ? result : 0;
}

/** 照 A `openEventRegLogModal`：使用瀏覽器當地時間。 */
export function formatRegLogTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 照 A `openEventRegLogModal`：合併全部報名與七種操作，時間遞減。 */
export function mergeEventRegLogs(
  registrations: readonly RegLogRegistration[],
  operations: readonly RegLogOperation[],
): RegLogEntry[] {
  const entries: RegLogEntry[] = [];
  for (const registration of registrations) {
    const userName = String(registration.companionName || registration.userName || '未知');
    if (registration.registeredAt) {
      entries.push({
        ms: regLogTimeMs(registration.registeredAt),
        userName, action: 'register', label: '報名', actionClass: 'reg',
      });
    }
    if (registration.status === 'cancelled' && registration.cancelledAt) {
      entries.push({
        ms: regLogTimeMs(registration.cancelledAt),
        userName, action: 'cancel', label: '取消', actionClass: 'cancel',
      });
    }
  }

  for (const operation of operations) {
    if (typeof operation.type !== 'string'
      || !Object.prototype.hasOwnProperty.call(OPERATIONS, operation.type)) continue;
    const config = OPERATIONS[operation.type as keyof typeof OPERATIONS];
    let ms = regLogTimeMs(operation.createdAt);
    if (!ms) {
      const matched = operation.id.match(/op_(\d{13,})/);
      if (matched?.[1]) ms = Number(matched[1]);
    }
    if (!ms) continue;
    const detail = String(operation.content || '');
    const waitlisted = detail.indexOf('候補 ');
    const moved = detail.indexOf('將 ');
    let extracted = '';
    if (waitlisted >= 0) {
      extracted = detail.slice(waitlisted + 3)
        .replace(/\s*自動遞補.*/, '').replace(/\s*降為.*/, '').trim();
    } else if (moved >= 0) {
      extracted = detail.slice(moved + 2)
        .replace(/\s*從候補.*/, '').replace(/\s*下放.*/, '').trim();
    } else {
      extracted = detail;
    }
    entries.push({
      ms,
      userName: extracted || detail,
      action: config.action,
      label: config.label,
      actionClass: config.action === 'team' ? 'promote' : config.action,
    });
  }
  return entries.sort((left, right) => right.ms - left.ms);
}

/** 照 A `openEventRegLogModal`，兩種查詢失敗分別處理。 */
export async function loadEventRegLog(
  eventId: string,
  eventDocId: string,
  cachedRegistrations: readonly RegLogRegistration[] = [],
): Promise<RegLogEntry[]> {
  if (!eventId || !eventDocId) return mergeEventRegLogs(cachedRegistrations, []);
  try {
    const [firebase, fs] = await Promise.all([getFirebase(), import('firebase/firestore')]);
    const [registrations, operations] = await Promise.all([
      (async (): Promise<RegLogRegistration[]> => {
        try {
          const snapshot = await fs.getDocs(
            fs.collection(firebase.db, 'events', eventDocId, 'registrations'),
          );
          return snapshot.docs.map(document => {
            const data = document.data();
            return {
              companionName: data.companionName,
              userName: data.userName,
              registeredAt: data.registeredAt,
              status: data.status,
              cancelledAt: data.cancelledAt,
            };
          });
        } catch {
          return [...cachedRegistrations];
        }
      })(),
      (async (): Promise<RegLogOperation[]> => {
        try {
          const snapshot = await fs.getDocs(fs.query(
            fs.collection(firebase.db, 'operationLogs'),
            fs.where('type', 'in', Object.keys(OPERATIONS)),
            fs.where('eventId', '==', eventId),
          ));
          return snapshot.docs.map(document => {
            const data = document.data();
            return {
              id: document.id,
              type: data.type,
              createdAt: data.createdAt,
              time: data.time,
              content: data.content,
            };
          });
        } catch {
          return [];
        }
      })(),
    ]);
    return mergeEventRegLogs(registrations, operations);
  } catch {
    return mergeEventRegLogs(cachedRegistrations, []);
  }
}
